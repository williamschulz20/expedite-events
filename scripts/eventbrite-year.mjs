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
      location: e.is_online_event ? "Online" : (v.name || a.localized_address_display || a.city || cityLabel),
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

let stored = 0, fetched = 0, blocked = 0;
for (const [slug, label, domain] of CITIES) {
  const batch = [];
  for (const [from, to] of months) {
    for (const q of QUERIES) {
      const url = `https://www.${domain}/d/${slug}/${q}/?start_date=${from}&end_date=${to}`;
      let html = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(25000) }).catch(() => null);
        if (res?.status === 429) { blocked++; await sleep(10000 * (attempt + 1)); continue; }
        if (res?.ok) html = await res.text().catch(() => "");
        break;
      }
      if (html) {
        const evs = mapEvents(extractServerData(html), label);
        fetched += evs.length;
        batch.push(...evs);
      }
      await sleep(700 + Math.random() * 600);
    }
  }
  const n = await ingest(batch);
  stored += n;
  console.log(`${label.padEnd(14)} fetched=${String(batch.length).padStart(5)} stored=${String(n).padStart(5)} (429s so far: ${blocked})`);
}
console.log(`\nTOTAL fetched=${fetched} stored=${stored}`);
