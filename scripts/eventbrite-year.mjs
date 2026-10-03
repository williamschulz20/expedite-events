#!/usr/bin/env node
// Month-by-month Eventbrite sweep for a full year ahead.
// Page-1-only scraping caps out ~2 months ahead; Eventbrite's ?start_date/
// ?end_date filters reach the whole year (verified: Dec 2026 -> 6,734 matches,
// Apr 2027 -> 1,735). One request per city x month x query, gently paced.
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CITIES = [
  ["united-kingdom--london", "London", "eventbrite.co.uk"],
  ["united-states--new-york", "New York", "eventbrite.com"],
  ["united-states--san-francisco", "San Francisco", "eventbrite.com"],
  ["germany--berlin", "Berlin", "eventbrite.de"],
  ["france--paris", "Paris", "eventbrite.fr"],
  ["netherlands--amsterdam", "Amsterdam", "eventbrite.nl"],
  ["united-states--austin", "Austin", "eventbrite.com"],
  ["united-states--boston", "Boston", "eventbrite.com"],
  ["united-states--los-angeles", "Los Angeles", "eventbrite.com"],
  ["united-states--seattle", "Seattle", "eventbrite.com"],
  ["united-states--chicago", "Chicago", "eventbrite.com"],
  ["united-states--miami", "Miami", "eventbrite.com"],
  ["ireland--dublin", "Dublin", "eventbrite.ie"],
  ["spain--barcelona", "Barcelona", "eventbrite.es"],
  ["sweden--stockholm", "Stockholm", "eventbrite.com"],
  ["portugal--lisbon", "Lisbon", "eventbrite.pt"],
  ["switzerland--zurich", "Zurich", "eventbrite.com"],
  ["denmark--copenhagen", "Copenhagen", "eventbrite.com"],
];
const QUERIES = ["startup", "founder", "tech-conference", "pitch", "hackathon", "venture-capital"];

function extractServerData(html) {
  const m = /window\.__SERVER_DATA__\s*=\s*/.exec(html);
  if (!m) return null;
  const start = html.indexOf("{", m.index + m[0].length - 1);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { if (--depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

function withCity(venue, city) {
  if (!venue) return city;
  if (!city || venue.toLowerCase().includes(city.toLowerCase())) return venue;
  return `${venue}, ${city}`;
}

function mapEvents(sd, cityLabel) {
  const ev = sd?.search_data?.events ?? {};
  const raw = [...(ev.results ?? []), ...(ev.promoted_results ?? [])];
  const out = [];
  for (const e of raw) {
    const url = (e.url ?? "").split("?")[0];
    if (!url || !e.name) continue;
    const v = e.primary_venue ?? {}, a = v.address ?? {};
    out.push({
      id: `eb-${e.eventbrite_event_id ?? e.id ?? url}`,
      title: e.name,
      description: (e.summary ?? "").slice(0, 500),
      date: e.start_date ? (e.start_time ? `${e.start_date}T${e.start_time}` : e.start_date) : "",
      endDate: e.end_date ? (e.end_time ? `${e.end_date}T${e.end_time}` : e.end_date) : undefined,
      // City appended so a bare venue name ("The Lincoln") can still be placed.
      location: e.is_online_event ? "Online" : withCity(v.name || a.localized_address_display || "", a.city || cityLabel),
      url,
      source: "eventbrite",
      category: "general",
    });
  }
  return out;
}

async function ingest(events) {
  let n = 0;
  for (let i = 0; i < events.length; i += 200) {
    const res = await fetch(`${BASE}/api/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: events.slice(i, i + 200) }),
      signal: AbortSignal.timeout(120000),
    }).catch(() => null);
    if (res) n += (await res.json().catch(() => ({}))).upserted ?? 0;
  }
  return n;
}

// Months: from next month through +12 (this month is already covered by the page-1 sweep).
const months = [];
const now = new Date();
for (let k = 1; k <= 12; k++) {
  const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
  const e = new Date(now.getFullYear(), now.getMonth() + k + 1, 0);
  const f = (x) => x.toISOString().slice(0, 10);
  months.push([f(d), f(e)]);
}

// The full 18 cities x 12 months x 6 queries is ~1,300 requests. CI IPs are
// throttled hard, and the old loop spent its whole 40 minutes retrying 429s
// without finishing one city. So: two cities a day in rotation (a full lap
// every nine days), a time budget, and stop as soon as Eventbrite starts
// refusing. Whatever was fetched is ingested month by month, never lost.
const CITIES_PER_RUN = Number(process.env.EB_CITIES_PER_RUN ?? 2);
const BUDGET_MS = Number(process.env.EB_BUDGET_MS ?? 25 * 60_000);
const MAX_CONSECUTIVE_BLOCKS = 4;
const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);
const first = (dayOfYear * CITIES_PER_RUN) % CITIES.length;
const todays = Array.from({ length: CITIES_PER_RUN }, (_, k) => CITIES[(first + k) % CITIES.length]);
const deadline = Date.now() + BUDGET_MS;
const startedAt = Date.now();

let stored = 0, fetched = 0, blocked = 0, consecutive = 0, stopped = "";
outer: for (const [slug, label, domain] of todays) {
  for (const [from, to] of months) {
    const batch = [];
    for (const q of QUERIES) {
      if (Date.now() > deadline) { stopped = "time budget reached"; break outer; }
      const url = `https://www.${domain}/d/${slug}/${q}/?start_date=${from}&end_date=${to}`;
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(25000) }).catch(() => null);
      if (!res || res.status === 429 || res.status >= 500) {
        blocked++;
        if (++consecutive >= MAX_CONSECUTIVE_BLOCKS) { stopped = "Eventbrite is refusing requests"; break outer; }
        await sleep(5000);
        continue;
      }
      consecutive = 0;
      const html = res.ok ? await res.text().catch(() => "") : "";
      if (html) {
        const evs = mapEvents(extractServerData(html), label);
        fetched += evs.length;
        batch.push(...evs);
      }
      await sleep(1200 + Math.random() * 800);
    }
    stored += await ingest(batch);
  }
  console.log(`${label.padEnd(14)} done (fetched so far ${fetched}, saved ${stored}, refused ${blocked})`);
}
if (stopped) console.log(`stopped early: ${stopped}`);
console.log(`\nTOTAL fetched=${fetched} saved=${stored} cities=${todays.map((c) => c[1]).join(", ")}`);

await fetch(`${BASE}/api/source-runs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    runId: process.env.GITHUB_RUN_ID ?? `local-${new Date().toISOString()}`,
    source: "eventbrite-deep",
    ok: fetched > 0,
    scraped: fetched,
    saved: stored,
    error: fetched > 0 ? (stopped || null) : (stopped || "returned no events"),
    durationMs: Date.now() - startedAt,
  }),
}).catch(() => {});
