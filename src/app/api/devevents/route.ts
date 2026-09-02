import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";
import { politeText, politeJSON, throttledBatch } from "@/lib/politeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// dev.events scraper (plus the developers.events JSON feed)
//
// PRIMARY: https://dev.events, a server-rendered (htmx) listing of developer
// conferences browsable by region: /EU /NA /AS /OC /SA /AF /ON (online).
// Each listing page embeds one <script type="application/ld+json"> schema.org
// EducationEvent block PER EVENT, carrying name, description, startDate,
// endDate, url and location. Parsing that JSON-LD is far more stable than
// parsing the Bulma markup, so that is what we do. Pagination is `?page=N`,
// 30 rows per page, and the page footer says "showing 30 out of 676", which
// tells us how many pages to walk. The deep pages hold the far-future
// listings (2027, 2028), exactly the coverage this app is short of.
//
// SECONDARY: https://developers.events/all-events.json, a separate curated
// dump of conferences and community events. This is what the route used to
// read exclusively, and it is why the endpoint returned 0: the feed's schema
// changed. Entries no longer carry `startDate: "YYYY-MM-DD"`, `endDate` or
// `online`; they now carry `date: [startEpochMs, endEpochMs?]` plus a
// `tags: [{key, value}]` array, and "online" is expressed as
// country === "Online". The old `isIn2026()` read `entry.startDate`, got
// `undefined` for every one of the 6124 rows, and filtered the whole feed
// away. Fixed below in `fromDevelopersEvents()`.
//
// No geographic allowlist: the old one kept Europe plus US/Canada only, which
// drops precisely the internationally-based founders this app exists to find.
// Relevance is decided downstream by scoreLeadQuality() (min score 35) and by
// the 12-month window in /api/events.
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

const DEV_EVENTS_ORIGIN = "https://dev.events";

// Region codes used in dev.events URLs. ON = "Online".
const REGIONS = ["EU", "NA", "ON", "AS", "SA", "AF", "OC"] as const;

const ROWS_PER_PAGE = 30;
const MAX_PAGES_PER_REGION = 30; // safety valve: 900 events per region
const DEVELOPERS_EVENTS_JSON = "https://developers.events/all-events.json";

// ---------------------------------------------------------------------------
// dev.events: JSON-LD extraction
// ---------------------------------------------------------------------------
interface LdPostalAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
}

interface LdEventNode {
  "@type"?: string;
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  image?: string | string[];
  eventAttendanceMode?: string;
  location?: { name?: string; address?: LdPostalAddress };
}

const LD_BLOCK_RE =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function extractLdEvents(html: string): LdEventNode[] {
  const out: LdEventNode[] = [];
  if (!html) return out;

  LD_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LD_BLOCK_RE.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue; // a malformed block must not kill the whole page
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const raw of nodes) {
      if (!raw || typeof raw !== "object") continue;
      const node = raw as LdEventNode;
      // EducationEvent / BusinessEvent / Event, but not BreadcrumbList etc.
      if (!/Event$/i.test(String(node["@type"] ?? ""))) continue;
      if (!node.name || !node.startDate || !node.url) continue;
      out.push(node);
    }
  }
  return out;
}

/** Footer reads "showing 30 out of 676 conferences". */
function parseTotalCount(html: string): number | null {
  const m = html.match(/showing\s+\d+\s+out\s+of\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

function toIso(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function ldLocation(node: LdEventNode): string {
  const name = node.location?.name?.trim();
  if (name) return name;

  const addr = node.location?.address;
  const parts = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  if (parts.length) return parts.join(", ");

  // dev.events omits `location` entirely for online-only events.
  if ((node.eventAttendanceMode ?? "").includes("Online")) return "Online";
  return "TBD";
}

function fromDevEvents(node: LdEventNode): FounderEvent | null {
  const date = toIso(node.startDate);
  if (!date) return null;

  const title = node.name!.trim();
  // The site's own description already carries the topic and the place, e.g.
  // "Artificial Intelligence (AI) conference in Vilnius, Lithuania".
  const description = (node.description ?? "").trim() || title;
  const image = Array.isArray(node.image) ? node.image[0] : node.image;

  return {
    id: `devev-${hashString(node.url!)}`,
    title,
    description,
    date,
    endDate: toIso(node.endDate) || undefined,
    location: ldLocation(node),
    url: node.url!,
    source: "devevents",
    category: categorizeEvent(title, description),
    imageUrl: image,
  };
}

async function fetchRegionPage(region: string, page: number): Promise<string> {
  const url =
    page <= 1
      ? `${DEV_EVENTS_ORIGIN}/${region}`
      : `${DEV_EVENTS_ORIGIN}/${region}?page=${page}`;
  return politeText(url, { retries: 2, timeoutMs: 20_000 });
}

async function scrapeDevEvents(): Promise<{
  nodes: LdEventNode[];
  pagesFetched: number;
  regionTotals: Record<string, number>;
}> {
  const nodes: LdEventNode[] = [];
  const regionTotals: Record<string, number> = {};
  let pagesFetched = 0;

  // Pass 1: first page of every region, which also tells us the region's size.
  const firstPages = await throttledBatch(
    REGIONS.map((region) => async () => {
      const html = await fetchRegionPage(region, 1);
      return { region, html };
    }),
    { concurrency: 3, pauseMs: 500 },
  );

  const followUps: Array<() => Promise<LdEventNode[]>> = [];

  for (const { region, html } of firstPages) {
    if (!html) continue;
    pagesFetched++;
    nodes.push(...extractLdEvents(html));

    const total = parseTotalCount(html);
    if (total === null) continue;
    regionTotals[region] = total;

    const pages = Math.min(
      Math.ceil(total / ROWS_PER_PAGE),
      MAX_PAGES_PER_REGION,
    );
    for (let page = 2; page <= pages; page++) {
      followUps.push(async () => extractLdEvents(await fetchRegionPage(region, page)));
    }
  }

  // Pass 2: the remaining pages, which is where the far-future listings live.
  const rest = await throttledBatch(followUps, { concurrency: 3, pauseMs: 400 });
  for (const batch of rest) {
    if (batch.length) pagesFetched++;
    nodes.push(...batch);
  }

  return { nodes, pagesFetched, regionTotals };
}

// ---------------------------------------------------------------------------
// developers.events: current JSON shape
// ---------------------------------------------------------------------------
interface DevelopersEventsEntry {
  name?: string;
  /** [startEpochMs] or [startEpochMs, endEpochMs] */
  date?: Array<number | string>;
  hyperlink?: string;
  location?: string;
  city?: string;
  country?: string;
  status?: string;
  tags?: Array<{ key?: string; value?: string }>;
}

function epochToIso(value: number | string | undefined): string {
  if (value === undefined || value === null) return "";
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function prettyTag(value: string): string {
  return value.replace(/[-_]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Dedup helpers
//
// The two feeds regularly disagree about a conference's start date, sometimes
// by weeks (AMTSO Cyber Research Conference in Brussels is listed on Sep 20 by
// one and Oct 20 by the other). So a same-title, same-city pair that comes
// from two different feeds is treated as one event over a wide window, while
// two entries from the same feed have to be within a few days of each other
// before they collapse. That keeps a genuine monthly meetup series intact.
// ---------------------------------------------------------------------------
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeTitle(title: string): string {
  return deaccent(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "Rome (Italy)", "Rome, Italy" and "Rome, IT" all reduce to "rome". */
function cityToken(location: string): string {
  const first = (location || "").split(/[,(]/)[0];
  return deaccent(first).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isDevEventsUrl(url: string): boolean {
  return url.startsWith(`${DEV_EVENTS_ORIGIN}/`);
}

function fromDevelopersEvents(entry: DevelopersEventsEntry): FounderEvent | null {
  const title = (entry.name ?? "").trim();
  const url = (entry.hyperlink ?? "").trim();
  if (!title || !url) return null;

  const date = epochToIso(entry.date?.[0]);
  if (!date) return null;

  const location =
    (entry.location ?? "").trim() ||
    [entry.city, entry.country].filter(Boolean).join(", ") ||
    "TBD";

  const topics = (entry.tags ?? [])
    .filter((t) => t?.key === "tech" || t?.key === "topic")
    .map((t) => prettyTag(t.value ?? ""))
    .filter(Boolean);

  const description = topics.length
    ? `${topics.join(", ")} event in ${location}`
    : `Developer event in ${location}`;

  return {
    id: `devev-${hashString(url)}`,
    title,
    description,
    date,
    endDate: epochToIso(entry.date?.[1]) || undefined,
    location,
    url,
    source: "devevents",
    category: categorizeEvent(title, description),
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
interface DevEventsPayload {
  events: FounderEvent[];
  count: number;
  source: string;
  meta: Record<string, unknown>;
}

async function buildPayload(): Promise<DevEventsPayload> {
  const now = Date.now();
  const startOfToday = new Date(new Date().toISOString().slice(0, 10)).getTime();

  let devEventsRaw = 0;
  let developersEventsRaw = 0;
  let pagesFetched = 0;
  let regionTotals: Record<string, number> = {};

  const collected: FounderEvent[] = [];

  // --- dev.events (primary) ---
  try {
    const scraped = await scrapeDevEvents();
    pagesFetched = scraped.pagesFetched;
    regionTotals = scraped.regionTotals;
    for (const node of scraped.nodes) {
      const ev = fromDevEvents(node);
      if (ev) {
        devEventsRaw++;
        collected.push(ev);
      }
    }
  } catch {
    // fall through to the JSON feed
  }

  // --- developers.events (secondary) ---
  try {
    const data = await politeJSON<DevelopersEventsEntry[]>(DEVELOPERS_EVENTS_JSON, {
      retries: 2,
      timeoutMs: 30_000,
    });
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (entry?.status && entry.status !== "open") continue;
        const ev = fromDevelopersEvents(entry);
        if (ev) {
          developersEventsRaw++;
          collected.push(ev);
        }
      }
    }
  } catch {
    // whatever dev.events returned still stands
  }

  if (collected.length === 0) {
    return {
      events: [],
      count: 0,
      source: "devevents",
      meta: { devEventsRaw, developersEventsRaw, pagesFetched, regionTotals },
    };
  }

  // Keep upcoming only. A multi-day event running right now still counts.
  const upcoming = collected.filter((e) => {
    const end = e.endDate ? new Date(e.endDate).getTime() : new Date(e.date).getTime();
    return Number.isFinite(end) && end >= startOfToday;
  });

  // Dedup pass 1: exact same URL.
  const byUrl = new Map<string, FounderEvent>();
  for (const e of upcoming) {
    const key = e.url.replace(/\/+$/, "").toLowerCase();
    if (!byUrl.has(key)) byUrl.set(key, e);
  }

  // Dedup pass 2: same title in the same city, on dates close enough together
  // to be the same event rather than a repeating series.
  const byTitleCity = new Map<string, FounderEvent[]>();
  for (const e of byUrl.values()) {
    const key = `${normalizeTitle(e.title)}|${cityToken(e.location)}`;
    const group = byTitleCity.get(key);
    if (group) group.push(e);
    else byTitleCity.set(key, [e]);
  }

  const DAY_MS = 86_400_000;
  const survivors: FounderEvent[] = [];
  for (const group of byTitleCity.values()) {
    group.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const kept: FounderEvent[] = [];
    for (const e of group) {
      const prev = kept[kept.length - 1];
      if (prev) {
        const gapDays =
          (new Date(e.date).getTime() - new Date(prev.date).getTime()) / DAY_MS;
        const crossFeed = isDevEventsUrl(prev.url) !== isDevEventsUrl(e.url);
        if (gapDays <= 3 || (crossFeed && gapDays <= 90)) {
          // Same event listed twice. Keep the dev.events record when there is
          // one: it has a canonical listing page, an image, and a topic in
          // its description.
          if (!isDevEventsUrl(prev.url) && isDevEventsUrl(e.url)) {
            kept[kept.length - 1] = e;
          }
          continue;
        }
      }
      kept.push(e);
    }
    survivors.push(...kept);
  }

  // Dedup pass 3: same title on the same day, but the two feeds name the
  // place at different granularity, so pass 2 could not see it. dev.events
  // says "Zurich, Switzerland" where developers.events says "Dietlikon
  // (Switzerland)"; "Oslo" vs "Lillestrom"; "Cologne" vs "Koln". Only
  // collapse a cross-feed pair, so two same-day sibling events listed by one
  // feed are left alone.
  const byTitleDay = new Map<string, FounderEvent[]>();
  for (const e of survivors) {
    const key = `${normalizeTitle(e.title)}|${e.date.slice(0, 10)}`;
    const group = byTitleDay.get(key);
    if (group) group.push(e);
    else byTitleDay.set(key, [e]);
  }

  const events: FounderEvent[] = [];
  for (const group of byTitleDay.values()) {
    const fromDevEventsSite = group.filter((e) => isDevEventsUrl(e.url));
    const isCrossFeed =
      fromDevEventsSite.length > 0 && fromDevEventsSite.length < group.length;
    if (isCrossFeed) events.push(fromDevEventsSite[0]);
    else events.push(...group);
  }

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const beyond60Days = events.filter(
    (e) => new Date(e.date).getTime() > now + 60 * 24 * 60 * 60 * 1000,
  ).length;

  return {
    events,
    count: events.length,
    source: "devevents",
    meta: {
      devEventsRaw,
      developersEventsRaw,
      pagesFetched,
      regionTotals,
      beyond60Days,
      lastStartDate: events.length ? events[events.length - 1].date : null,
      builtAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler
//
// A full sweep is ~50 page fetches and takes about 15s, which is longer than
// the 8s budget /api/events allows a source on a cold build. Memoising the
// result for 30 minutes means only the first sweep pays that, and it keeps
// repeated aggregation runs off dev.events entirely. `?refresh=1` forces a
// fresh sweep. In-flight coalescing stops two concurrent callers from
// scraping the site twice over.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 30 * 60 * 1000;

let cached: { at: number; payload: DevEventsPayload } | null = null;
let inFlight: Promise<DevEventsPayload> | null = null;

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.payload, cached: true });
  }

  if (!inFlight) {
    inFlight = buildPayload().finally(() => {
      inFlight = null;
    });
  }

  let payload: DevEventsPayload;
  try {
    payload = await inFlight;
  } catch {
    payload = { events: [], count: 0, source: "devevents", meta: {} };
  }

  if (payload.count === 0) {
    // Never serve a hollow success: a stale sweep beats an empty one.
    if (cached) return NextResponse.json({ ...cached.payload, cached: true, stale: true });
    return NextResponse.json(
      {
        ...payload,
        error: "Both dev.events and developers.events returned nothing",
      },
      { status: 502 },
    );
  }

  cached = { at: Date.now(), payload };
  return NextResponse.json({ ...payload, cached: false });
}
