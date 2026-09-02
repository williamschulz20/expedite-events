import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";
import { politeText, throttledBatch } from "@/lib/politeFetch";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// F6S event scraper
//
// STATUS (verified 2026-09-02): f6s.com is CLOSED to this scraper.
//
//  1. Every content path (/events, /events/<city>, /events?when=upcoming)
//     returns HTTP 200 with an Imperva / "reese84" anti-bot interstitial —
//     <title>Checking your browser</title>, <meta name="captcha-challenge">,
//     a /v2-captcha script and a "We think you might be a bot" block page.
//     The real listing markup is never served; there is nothing to parse.
//     https://www.f6s.com/sitemaps/index-sitemap.xml returns 403 with the
//     same body, so the sitemap is not a way around it either.
//
//  2. https://www.f6s.com/robots.txt ends with
//         User-agent: *
//         Disallow: /
//     Only a named allowlist (Googlebot, bingbot, Applebot, OAI-SearchBot,
//     PerplexityBot, …) is permitted to crawl at all.
//
// Getting real data out would mean solving the JS/captcha challenge or
// spoofing an allowlisted crawler's identity. We do neither. This route
// therefore makes ONE gentle probe per call, reports the block honestly
// (blocked: true + reason) instead of pretending the source is merely empty,
// and only parses if F6S ever serves real HTML again. The old version fired
// 16 city requests per call into that wall, which is how you earn an IP ban.
// ---------------------------------------------------------------------------

const BASE = "https://www.f6s.com";
const PROBE_URL = `${BASE}/events`;

// Only crawled if the probe shows F6S is actually serving listing HTML.
const CITY_PATHS = [
  "/events/london",
  "/events/berlin",
  "/events/new-york",
  "/events/san-francisco",
  "/events/paris",
  "/events/amsterdam",
];

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/** True when the response is the anti-bot interstitial rather than a page. */
function isChallengePage(html: string): boolean {
  if (!html) return true;
  return (
    /captcha-challenge/i.test(html) ||
    /<title>\s*Checking your browser\s*<\/title>/i.test(html) ||
    /reeseSkipExpirationCheck/i.test(html) ||
    /We think you might be a bot/i.test(html) ||
    /\/v2-captcha/i.test(html)
  );
}

// ---------------------------------------------------------------------------
// Parsing (only reachable if F6S serves real markup)
// ---------------------------------------------------------------------------
interface RawEvent {
  title: string;
  url: string;
  date: string;
  location: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(href: string): string {
  if (!href) return "";
  return href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "15 Jan 2026" / "Jan 15, 2026" -> ISO. Returns "" when unparseable. */
function parseLooseDate(text: string): string {
  const dmy = text.match(
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})/i
  );
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase().slice(0, 3)];
    if (month) return `${dmy[3]}-${month}-${dmy[1].padStart(2, "0")}T09:00:00Z`;
  }
  const mdy = text.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase().slice(0, 3)];
    if (month) return `${mdy[3]}-${month}-${mdy[2].padStart(2, "0")}T09:00:00Z`;
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T09:00:00Z`;
  return "";
}

type LdNode = Record<string, unknown>;

function ldLocation(loc: unknown): string {
  if (typeof loc === "string") return decodeEntities(loc);
  if (loc && typeof loc === "object") {
    const o = loc as LdNode;
    if (typeof o.name === "string") return decodeEntities(o.name);
    const addr = o.address;
    if (typeof addr === "string") return decodeEntities(addr);
    if (addr && typeof addr === "object") {
      const a = addr as LdNode;
      const parts = [a.addressLocality, a.addressRegion, a.addressCountry]
        .filter((p): p is string => typeof p === "string");
      if (parts.length) return decodeEntities(parts.join(", "));
    }
  }
  return "";
}

function collectLdNodes(value: unknown, out: LdNode[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectLdNodes(v, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as LdNode;
  out.push(node);
  if (node["@graph"]) collectLdNodes(node["@graph"], out);
  if (Array.isArray(node.itemListElement)) {
    for (const el of node.itemListElement) {
      collectLdNodes(el, out);
      if (el && typeof el === "object" && (el as LdNode).item) {
        collectLdNodes((el as LdNode).item, out);
      }
    }
  }
}

function parseJsonLd(html: string): RawEvent[] {
  const events: RawEvent[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes: LdNode[] = [];
    collectLdNodes(parsed, nodes);
    for (const node of nodes) {
      const type = node["@type"];
      const types = Array.isArray(type) ? type : [type];
      const isEvent = types.some(
        (t) => typeof t === "string" && /Event$/i.test(t)
      );
      if (!isEvent || typeof node.name !== "string") continue;
      events.push({
        title: decodeEntities(node.name),
        url: typeof node.url === "string" ? absolute(node.url) : "",
        date: typeof node.startDate === "string" ? node.startDate : "",
        location: ldLocation(node.location),
      });
    }
  }
  return events;
}

/** Fallback: anchors to /event/<slug>, with the anchor text as the title. */
function parseEventLinks(html: string, fallbackLocation: string): RawEvent[] {
  const events: RawEvent[] = [];
  const re = /<a[^>]+href=["']((?:https?:\/\/(?:www\.)?f6s\.com)?\/event\/[^"'#?]+)[^"']*["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, " "));
    if (title.length < 4) continue;
    const context = html.slice(m.index, m.index + 1200).replace(/<[^>]+>/g, " ");
    events.push({
      title,
      url: absolute(m[1]),
      date: parseLooseDate(decodeEntities(context)),
      location: fallbackLocation,
    });
  }
  return events;
}

function toFounderEvents(raw: RawEvent[], fallbackLocation: string): FounderEvent[] {
  return raw.map((r) => {
    const location = r.location || fallbackLocation;
    const description = `F6S startup event${location ? ` in ${location}` : ""}`;
    return {
      id: `f6s-${hashString(r.url || r.title + r.date)}`,
      title: r.title,
      description,
      date: r.date,
      location,
      url: r.url || PROBE_URL,
      source: "f6s",
      category: categorizeEvent(r.title, description),
    };
  });
}

function parsePage(html: string, fallbackLocation: string): FounderEvent[] {
  const raw = [...parseJsonLd(html), ...parseEventLinks(html, fallbackLocation)];
  const seen = new Set<string>();
  const deduped: RawEvent[] = [];
  for (const ev of raw) {
    const key = ev.url || ev.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }
  return toFounderEvents(deduped, fallbackLocation);
}

function cityFromPath(path: string): string {
  return path
    .replace("/events/", "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const probe = await politeText(PROBE_URL, { retries: 1, timeoutMs: 20_000 });

  if (isChallengePage(probe)) {
    // Honest empty result: the source is blocked, not barren. Do NOT fabricate
    // events here and do NOT hammer the remaining city pages.
    return NextResponse.json({
      events: [],
      count: 0,
      source: "f6s",
      blocked: true,
      reason:
        "f6s.com serves an Imperva anti-bot interstitial (\"Checking your browser\" / captcha-challenge) on every listing URL, and robots.txt sets `User-agent: * / Disallow: /`. No event markup is reachable without circumventing bot detection, which this scraper will not do.",
    });
  }

  const collected: FounderEvent[] = [...parsePage(probe, "")];

  const pages = await throttledBatch(
    CITY_PATHS.map((path) => async () => {
      const html = await politeText(`${BASE}${path}`, { retries: 1 });
      if (isChallengePage(html)) return [] as FounderEvent[];
      return parsePage(html, cityFromPath(path));
    }),
    { concurrency: 2, pauseMs: 1200 }
  );
  for (const list of pages) collected.push(...list);

  // Dedupe, drop past events, keep the rolling 365-day horizon.
  const now = Date.now();
  const horizon = now + 365 * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const events: FounderEvent[] = [];
  for (const ev of collected) {
    if (seen.has(ev.id)) continue;
    if (ev.date) {
      const t = new Date(ev.date).getTime();
      if (!Number.isFinite(t) || t < now || t > horizon) continue;
    }
    seen.add(ev.id);
    events.push(ev);
  }

  events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return NextResponse.json({ events, count: events.length, source: "f6s" });
}
