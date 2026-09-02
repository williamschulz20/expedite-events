import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import { politeText, sleep, throttledBatch } from "@/lib/politeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Generic web-search discovery: startup/founder events in cities the
// platform-specific scrapers (Luma / Eventbrite / Meetup / Partiful) miss.
//
// WHY THIS USED TO RETURN 0
// -------------------------
// The previous implementation scraped https://html.duckduckgo.com/html/.
// That endpoint now answers every server-side request with HTTP 202 and a
// bot-challenge page ("Please complete the following challenge... Select all
// squares containing a duck"), so `class="result__a"` never matched a single
// result and every query returned []. The same is true of every other keyless
// general-search endpoint worth trying: Mojeek, Startpage, Brave and the
// public SearXNG instances all serve JS/CAPTCHA interstitials to a plain
// fetch, Qwant's API answers 403, and Bing's RSS view returns one unrelated
// item. Those challenges are not something to work around, so SERP scraping
// is a dead end here.
//
// WHAT IT DOES NOW
// ----------------
// Searches AllEvents.in, a web-wide event index that aggregates event pages
// from across the open web (Facebook, Eventbrite, Meetup, ticketing sites,
// organiser sites), so it reaches cities no dedicated scraper covers.
//
//   Discovery: https://allevents.in/{city}/{category}?page=N
//              server-rendered `event-card` list, 15 per page.
//   Detail:    the event page carries a JSON-LD `Event` block with the real
//              description and an exact ISO startDate/endDate.
//
// The site also exposes a JSON search API (POST /api/events/list) that takes
// keywords plus an sdate/edate window, which is much better for far-future
// coverage in dense cities. It rate-limits hard, though: it starts answering
// `529 Unauthorized Crawling Reported` and stays that way for a while. So it
// is used only opportunistically, with one probe up front, and the whole API
// leg is skipped for the rest of the request if that probe comes back blocked.
//
// Everything is throttled (concurrency 3, pauses between waves) and there is a
// circuit breaker: once enough fetches come back empty the remaining tasks
// short-circuit instead of hammering a host that has stopped answering.
// ---------------------------------------------------------------------------

const SEARCH_API = "https://allevents.in/api/events/list";
const BASE = "https://allevents.in";

// Matches the floor applied downstream in /api/events processEvents().
const MIN_SCORE = 35;

// Cities NOT well covered by the Luma / Eventbrite / Partiful scrapers.
// Slugs verified against the live index; cities that return nothing
// (tartu, porto, valencia, milan, malmo, belgrade) are deliberately omitted.
const CITY_TARGETS: Array<{ city: string; country: string; label: string }> = [
  // Baltics, high Expedite relevance
  { city: "tallinn", country: "estonia", label: "Tallinn, Estonia" },
  { city: "riga", country: "latvia", label: "Riga, Latvia" },
  { city: "vilnius", country: "lithuania", label: "Vilnius, Lithuania" },
  // UK outside London
  { city: "edinburgh", country: "united kingdom", label: "Edinburgh, UK" },
  { city: "manchester", country: "united kingdom", label: "Manchester, UK" },
  { city: "bristol", country: "united kingdom", label: "Bristol, UK" },
  { city: "cambridge", country: "united kingdom", label: "Cambridge, UK" },
  { city: "glasgow", country: "united kingdom", label: "Glasgow, UK" },
  // France outside Paris
  { city: "lyon", country: "france", label: "Lyon, France" },
  { city: "marseille", country: "france", label: "Marseille, France" },
  { city: "toulouse", country: "france", label: "Toulouse, France" },
  // Poland outside Warsaw
  { city: "krakow", country: "poland", label: "Krakow, Poland" },
  { city: "wroclaw", country: "poland", label: "Wroclaw, Poland" },
  { city: "gdansk", country: "poland", label: "Gdansk, Poland" },
  // South-East / Central Europe
  { city: "bucharest", country: "romania", label: "Bucharest, Romania" },
  { city: "athens", country: "greece", label: "Athens, Greece" },
  { city: "sofia", country: "bulgaria", label: "Sofia, Bulgaria" },
  { city: "prague", country: "czech republic", label: "Prague, Czechia" },
  { city: "budapest", country: "hungary", label: "Budapest, Hungary" },
  // Netherlands outside Amsterdam
  { city: "rotterdam", country: "netherlands", label: "Rotterdam, Netherlands" },
  { city: "eindhoven", country: "netherlands", label: "Eindhoven, Netherlands" },
  // Nordics / DACH outside the usual suspects
  { city: "gothenburg", country: "sweden", label: "Gothenburg, Sweden" },
  { city: "hamburg", country: "germany", label: "Hamburg, Germany" },
  // US West Coast
  { city: "los angeles", country: "united states", label: "Los Angeles, CA" },
  { city: "san diego", country: "united states", label: "San Diego, CA" },
];

// Pre-filtered category listings on the index. `conferences` is the one that
// reliably reaches far into the future (annual events are listed months out),
// which is what the app is short of.
const CATEGORIES = ["technology", "entrepreneurship", "conferences"];

// Listings are date-ascending, so later pages are later events. Small cities
// run out after one or two pages, so each paginator stops on the first empty
// page rather than burning the whole budget.
const MAX_LIST_PAGES = 3;

// Optional API leg. Comma-separated bare tokens plus quoted phrases, the
// syntax the site's own category pages use; all-quoted queries match almost
// nothing outside very dense cities.
const API_QUERY =
  'startup,"startup",founder,"founders",entrepreneur,"venture capital",conference,summit,forum,"demo day","pitch",hackathon,accelerator,investor,tech,technology,innovation';

// Windows in days from today. Both sit beyond the two-month mark the app is
// starved past, which is the whole reason for the API leg.
const API_WINDOWS: Array<[number, number]> = [
  [55, 180],
  [180, 365],
];

const MAX_ENRICH = 140;
// Consecutive empty responses that mean the host has stopped talking to us.
// Isolated misses are normal (some city/category combinations simply 404, and
// the host throttles in short bursts that politeText's backoff rides out).
const CONSECUTIVE_FAILURE_BUDGET = 25;

// Category / tag tokens on the index that indicate a business or tech event.
const RELEVANT_TOKENS = [
  "business", "conferences", "conference", "technology", "tech", "it",
  "artificial-intelligence", "machine-learning", "data-science",
  "cyber-security", "robotics", "blockchain", "software", "developer",
  "startups", "startup", "entrepreneurship", "entrepreneur", "innovation",
  "networking", "meetups", "leadership", "finance", "investment",
  "science", "engineering", "product", "marketing", "summit", "forum", "expo",
];

const RELEVANT_TITLE_RE =
  /\b(startup|start-?up|founder|entrepreneur|venture|investor|angel|hackathon|accelerator|incubator|demo day|pitch|saas|fintech|deeptech|deep tech|web3|blockchain|ai|artificial intelligence|machine learning|tech|technology|digital|innovation|summit|conference|forum|expo|congress|meetup|networking|business)\b/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Candidate {
  url: string;          // canonical AllEvents event page
  title: string;
  approxDate: Date | null;
  location: string;
  meta: string;         // topic tokens plus organiser, used for scoring
  organizer?: string;
  ticketUrl?: string;
  startTs?: number;     // unix seconds, when the API supplied it
  endTs?: number;
  prelim: number;
}

interface ApiVenue {
  street?: string;
  city?: string;
  country?: string;
  full_address?: string;
}

interface ApiRecord {
  event_id?: string;
  eventname?: string;
  eventname_raw?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  venue?: ApiVenue;
  event_url?: string;
  organizer?: { name?: string };
  categories?: string[];
  tags?: string[];
  tickets?: { ticket_url?: string };
  custom_params?: { merged_lookup?: string[]; gemma_categories?: string[] };
}

interface LdEvent {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  location?: {
    name?: string;
    address?: { streetAddress?: string; addressLocality?: string };
  };
  offers?: { url?: string } | Array<{ url?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h << 5) - h + url.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Card date strings look like "Fri, 18 Sep, 2026 - 09:00 AM" or
 * "Wed, 23 Sep * 10:00 AM" (year omitted when it is the current one).
 * Only used to pre-filter and as a fallback; the event page's JSON-LD is
 * authoritative.
 */
function parseCardDate(raw: string, now: Date): Date | null {
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s*(\d{4})?/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  const year = m[3] ? Number(m[3]) : now.getUTCFullYear();
  const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
  if (!m[3] && d.getTime() < now.getTime() - 7 * 864e5) {
    return new Date(Date.UTC(year + 1, month, day, 12, 0, 0));
  }
  return d;
}

function normaliseTokens(tokens: string[]): string[] {
  const out = tokens
    .map((t) => String(t).toLowerCase().replace(/[-_]+/g, " ").trim())
    .filter(Boolean);
  return Array.from(new Set(out));
}

function buildMeta(tokens: string[], organiser?: string): string {
  const topics = normaliseTokens(tokens);
  const parts: string[] = [];
  if (topics.length) parts.push(topics.join(", "));
  if (organiser) parts.push(`Organiser: ${organiser}`);
  return parts.join(" ");
}

function looksRelevant(rawTokens: string[], title: string): boolean {
  if (rawTokens.some((t) => RELEVANT_TOKENS.includes(String(t).toLowerCase()))) return true;
  return RELEVANT_TITLE_RE.test(title);
}

function extractLdEvent(html: string): LdEvent | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const type = String((item as Record<string, unknown>)["@type"] ?? "");
      if (type.includes("Event")) return item as LdEvent;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Discovery A: category listing pages (always available)
// ---------------------------------------------------------------------------
function parseListingPage(html: string, fallbackLocation: string, now: Date): Candidate[] {
  const out: Candidate[] = [];
  const cards = html.matchAll(
    /<li class="event-card event-card-link"[^>]*data-link="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi
  );

  for (const card of cards) {
    const url = card[1];
    const body = card[2];
    if (!url.startsWith("http")) continue;

    // The <h3> inside the card keeps accents that data-name strips.
    const titleMatch =
      body.match(/<h3>\s*([\s\S]*?)\s*<\/h3>/i) ?? body.match(/title="([^"]+)"/i);
    const title = decodeEntities(titleMatch?.[1] ?? "");
    if (!title) continue;

    const dateRaw = body.match(/<div class="date"[^>]*>\s*([^<]+?)\s*<\/div>/i)?.[1] ?? "";
    const locRaw = body.match(/<div class="location[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/i)?.[1] ?? "";

    if (!looksRelevant([], title)) continue;

    out.push({
      url,
      title,
      approxDate: parseCardDate(decodeEntities(dateRaw), now),
      location: locRaw ? decodeEntities(locRaw) : fallbackLocation,
      meta: "",
      prelim: scoreLeadQuality(title, "").score,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discovery B: JSON search API (opportunistic, rate-limits aggressively)
// ---------------------------------------------------------------------------
async function apiSearch(body: Record<string, unknown>): Promise<ApiRecord[] | "blocked"> {
  try {
    const res = await fetch(SEARCH_API, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    // 429 / 5xx here means "you are crawling too fast". Do NOT retry into it.
    if (res.status === 429 || res.status >= 500 || !res.ok) return "blocked";
    const json = (await res.json()) as { data?: ApiRecord[] };
    return Array.isArray(json?.data) ? json.data : [];
  } catch {
    return "blocked";
  }
}

function apiRecordToCandidate(rec: ApiRecord, fallbackLocation: string): Candidate | null {
  const title = decodeEntities(rec.eventname_raw ?? rec.eventname ?? "");
  if (!title || !rec.event_url) return null;

  const cp = rec.custom_params ?? {};
  const tokens = [
    ...(rec.categories ?? []),
    ...(rec.tags ?? []),
    ...(cp.merged_lookup ?? []),
    ...(cp.gemma_categories ?? []),
  ];
  if (!looksRelevant(tokens, title)) return null;

  const startTs = Number(rec.start_time);
  const endTs = Number(rec.end_time);
  const v = rec.venue;
  const location =
    v?.full_address ||
    [v?.street, v?.city, v?.country].filter(Boolean).join(", ") ||
    rec.location ||
    fallbackLocation;

  const organiser = rec.organizer?.name ? decodeEntities(rec.organizer.name) : undefined;
  const meta = buildMeta(tokens, organiser);

  return {
    url: rec.event_url,
    title,
    approxDate: Number.isFinite(startTs) && startTs > 0 ? new Date(startTs * 1000) : null,
    location: decodeEntities(location),
    meta,
    organizer: organiser,
    ticketUrl:
      typeof rec.tickets?.ticket_url === "string" && /^https?:\/\//i.test(rec.tickets.ticket_url)
        ? rec.tickets.ticket_url
        : undefined,
    startTs: Number.isFinite(startTs) ? startTs : undefined,
    endTs: Number.isFinite(endTs) ? endTs : undefined,
    prelim: scoreLeadQuality(title, meta).score,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 365);

  let emptyResponses = 0;
  let consecutiveFailures = 0;
  let pagesFetched = 0;
  const tripped = () => consecutiveFailures > CONSECUTIVE_FAILURE_BUDGET;

  async function fetchPage(url: string, retries = 2): Promise<string> {
    if (tripped()) return "";
    pagesFetched++;
    const html = await politeText(url, { retries, timeoutMs: 20_000 });
    if (html) {
      consecutiveFailures = 0;
    } else {
      emptyResponses++;
      consecutiveFailures++;
    }
    return html;
  }

  // ---- 1a. Category listings --------------------------------------------
  // One sequential paginator per city/category so an exhausted listing stops
  // early instead of fetching three more empty pages.
  const listingTasks: Array<() => Promise<Candidate[]>> = [];
  for (const target of CITY_TARGETS) {
    const slug = target.city.replace(/\s+/g, "-");
    for (const category of CATEGORIES) {
      listingTasks.push(async () => {
        const found: Candidate[] = [];
        for (let page = 1; page <= MAX_LIST_PAGES; page++) {
          const url =
            page === 1 ? `${BASE}/${slug}/${category}` : `${BASE}/${slug}/${category}?page=${page}`;
          const html = await fetchPage(url);
          if (!html) break;
          const cards = parseListingPage(html, target.label, now);
          const cardCount = (html.match(/<li class="event-card event-card-link"/g) ?? []).length;
          found.push(...cards);
          if (cardCount === 0) break; // listing exhausted
          if (page < MAX_LIST_PAGES) await sleep(250);
        }
        return found;
      });
    }
  }

  const listingWaves = await throttledBatch(listingTasks, { concurrency: 3, pauseMs: 400 });

  const byUrl = new Map<string, Candidate>();
  for (const wave of listingWaves) {
    for (const c of wave) if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  const fromListings = byUrl.size;

  // ---- 1b. JSON search API, if it will talk to us ------------------------
  let apiUsed = false;
  const probe = await apiSearch({
    city: "los angeles",
    country: "united states",
    page: 1,
    rows: 20,
    popular: false,
    venue: [],
    keywords: API_QUERY,
    type: "",
    ids: [],
    sdate: "",
    edate: "",
  });

  if (probe !== "blocked" && probe.length > 0) {
    apiUsed = true;
    let apiBlocked = false;

    const apiTasks: Array<() => Promise<Candidate[]>> = [];
    for (const target of CITY_TARGETS) {
      for (const [fromDay, toDay] of API_WINDOWS) {
        const sdate = new Date(now);
        sdate.setDate(sdate.getDate() + fromDay);
        const edate = new Date(now);
        edate.setDate(edate.getDate() + toDay);

        apiTasks.push(async () => {
          if (apiBlocked) return [];
          const recs = await apiSearch({
            city: target.city,
            country: target.country,
            page: 1,
            rows: 20,
            popular: false,
            venue: [],
            keywords: API_QUERY,
            type: "",
            ids: [],
            sdate: isoDay(sdate),
            edate: isoDay(edate),
          });
          if (recs === "blocked") {
            apiBlocked = true; // stop the whole leg on the first refusal
            return [];
          }
          return recs
            .map((r) => apiRecordToCandidate(r, target.label))
            .filter((c): c is Candidate => c !== null);
        });
      }
    }

    const apiWaves = await throttledBatch(apiTasks, { concurrency: 2, pauseMs: 600 });
    for (const wave of apiWaves) {
      for (const c of wave) {
        const existing = byUrl.get(c.url);
        // API records carry topic metadata, so prefer them over bare cards.
        if (!existing || !existing.meta) byUrl.set(c.url, c);
      }
    }
    await sleep(200);
  }

  // ---- 2. Gate and rank --------------------------------------------------
  const candidates = Array.from(byUrl.values()).filter((c) => {
    if (!c.approxDate) return true; // unknown date, let enrichment decide
    return c.approxDate >= new Date(now.getTime() - 864e5) && c.approxDate <= horizon;
  });

  // Strongest signal first, and among equals the furthest-out event first:
  // the app is short of anything more than two months away.
  candidates.sort((a, b) => {
    if (b.prelim !== a.prelim) return b.prelim - a.prelim;
    const at = a.approxDate?.getTime() ?? 0;
    const bt = b.approxDate?.getTime() ?? 0;
    return bt - at;
  });
  const toEnrich = candidates.slice(0, MAX_ENRICH);

  // ---- 3. Enrich from the event page's JSON-LD ---------------------------
  // Let any short-lived throttle from the listing sweep decay first.
  await sleep(1200);

  const enrichTasks = toEnrich.map((c) => async () => {
    const html = await fetchPage(c.url, 1);
    return { candidate: c, ld: html ? extractLdEvent(html) : null };
  });

  const enriched = await throttledBatch(enrichTasks, { concurrency: 3, pauseMs: 350 });

  // ---- 4. Build and score ------------------------------------------------
  const events: FounderEvent[] = [];
  const seenIds = new Set<string>();

  for (const { candidate, ld } of enriched) {
    // Date: the page's JSON-LD is authoritative (local ISO with offset).
    let date = "";
    if (typeof ld?.startDate === "string" && !Number.isNaN(new Date(ld.startDate).getTime())) {
      date = ld.startDate;
    } else if (candidate.startTs) {
      date = new Date(candidate.startTs * 1000).toISOString();
    } else if (candidate.approxDate) {
      date = candidate.approxDate.toISOString();
    }
    if (!date) continue;

    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime()) || parsed < now || parsed > horizon) continue;

    let endDate: string | undefined;
    if (typeof ld?.endDate === "string" && !Number.isNaN(new Date(ld.endDate).getTime())) {
      endDate = ld.endDate;
    } else if (candidate.endTs && candidate.startTs && candidate.endTs > candidate.startTs) {
      endDate = new Date(candidate.endTs * 1000).toISOString();
    }

    const title = decodeEntities(ld?.name ?? candidate.title).slice(0, 200);

    // Description is the real blurb from the event page plus the index's own
    // topic tags, so /api/events re-scoring sees the same text this route did.
    const blurb = decodeEntities(String(ld?.description ?? "")).slice(0, 600);
    const description = [blurb, candidate.meta ? `Topics: ${candidate.meta}` : ""]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 800);

    const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(title, description);
    if (score < MIN_SCORE) continue;

    const id = `web-${hashUrl(candidate.url)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const addr = ld?.location?.address;
    const ldLocation = [ld?.location?.name, addr?.streetAddress, addr?.addressLocality]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .join(", ");

    const offers = ld?.offers;
    const offerUrl = Array.isArray(offers) ? offers[0]?.url : offers?.url;

    events.push({
      id,
      title,
      description,
      date,
      endDate,
      location: (ldLocation ? decodeEntities(ldLocation) : candidate.location).slice(0, 300),
      url:
        candidate.ticketUrl ??
        (typeof offerUrl === "string" && /^https?:\/\//i.test(offerUrl) ? offerUrl : candidate.url),
      source: "websearch",
      category: categorizeEvent(title, description),
      leadScore: score,
      leadTier: tier,
      highLeverage,
      leverageReason,
      organizerName: candidate.organizer?.slice(0, 120),
    });
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const twoMonths = now.getTime() + 60 * 864e5;
  const beyondTwoMonths = events.filter((e) => new Date(e.date).getTime() > twoMonths).length;

  return NextResponse.json({
    events,
    count: events.length,
    source: "websearch",
    stats: {
      pagesFetched,
      listings: listingTasks.length,
      fromListings,
      apiUsed,
      candidates: candidates.length,
      enriched: enriched.length,
      failedFetches: emptyResponses,
      circuitTripped: tripped(),
      beyondTwoMonths,
    },
  });
}
