import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// City slugs — scraped via __NEXT_DATA__ + paginated place API
// ---------------------------------------------------------------------------
const CITY_SLUGS = [
  // Western Europe
  "london", "amsterdam", "berlin", "paris", "munich", "zurich", "stockholm",
  "barcelona", "lisbon", "dublin", "helsinki", "copenhagen", "milan", "madrid",
  "vienna", "warsaw", "brussels", "budapest", "prague", "rome", "hamburg",
  "geneva", "lausanne", "istanbul",
  // Baltics & Nordics
  "tallinn", "riga", "vilnius", "oslo",
  // Central & Eastern Europe
  "bucharest", "sofia", "belgrade", "zagreb", "krakow",
  // North America
  "sf", "new-york", "austin", "boston",
];

// ---------------------------------------------------------------------------
// Community / organizer pages — these are invisible to keyword search
// ---------------------------------------------------------------------------
const COMMUNITY_SLUGS = [
  // Accelerators & programs
  "ef",                    // Entrepreneur First
  "antler",                // Antler
  "techstars",             // Techstars
  "seedcamp",              // Seedcamp
  "a16z",                  // Andreessen Horowitz
  "ycombinator",           // Y Combinator
  "entrepreneur-first",    // EF alias
  "ondeck",                // On Deck — global founder fellowship
  "beondeck",              // On Deck alias
  "southparkcommons",      // South Park Commons
  "spc",                   // SPC alias
  "pioneer",               // Pioneer — remote accelerator
  "500global",             // 500 Global (formerly 500 Startups)
  "plug-and-play",         // Plug and Play
  "founders-factory",      // Founders Factory London
  "joinef",                // EF another alias
  // European VCs & ecosystems
  "balderton",             // Balderton Capital
  "atomico",               // Atomico
  "notion-capital",        // Notion Capital
  "cherry-ventures",       // Cherry Ventures
  "point-nine",            // Point Nine Capital
  "earlybird",             // Earlybird VC
  "station-f",             // Station F Paris
  "speedinvest",           // Speedinvest (Vienna/Berlin)
  "northzone",             // Northzone (Nordics)
  "creandum",              // Creandum (Nordics)
  "byFounders",            // byFounders (Nordics)
  "byfounders",            // byFounders lowercase alias
  "index-ventures",        // Index Ventures
  "fly-ventures",          // Fly Ventures Berlin
  "project-a",             // Project A (Berlin)
  "htgf",                  // High-Tech Gründerfonds
  // London startup scene
  "silicon-roundabout",    // Silicon Roundabout / Tech City
  "legaltech-london",
  "ai-london",
  "london-founders",
  "founders-forum",        // Founders Forum
  "plexal",                // Plexal (London tech hub)
  "techround",             // TechRound events
  "coadec",                // Coalition for a Digital Economy
  "startupgrind-london",   // Startup Grind London
  "tech-nation",           // Tech Nation UK
  // Berlin & DACH
  "berlin-founders",
  "factory-berlin",        // Factory Berlin
  "berlin-startup",
  "german-accelerator",    // German Accelerator
  // Paris & France
  "lafrenchtech",          // La French Tech
  "numa",                  // NUMA Paris
  // Nordics & Baltics
  "latitude59",            // Latitude59 Tallinn
  "garage48",              // Garage48 (Baltic hackathons)
  "nordicmakers",          // Nordic Makers
  "slush",                 // Slush Helsinki
  "sting",                 // Sting accelerator Stockholm
  "startup-estonia",       // Startup Estonia
  "startup-wise-guys",     // Startup Wise Guys (Baltics)
  // AI / deep tech
  "ai-safety",
  "deeptech-founders",
  "llm-community",
  "ai-builders",
  "huggingface",           // Hugging Face community
  "eleutherai",            // EleutherAI
  "aicamp",                // AI Camp meetups
  // Founder communities & networks
  "founders-network",
  "startup-grind",         // Startup Grind global
  "first-round",           // First Round Capital
  "general-catalyst",      // General Catalyst
  "lsvp",                  // Lightspeed VP
  "nfx",                   // NFX (network effects VC)
  "villageglobal",         // Village Global
  "techstars-london",
  "techstars-berlin",
  "angels-london",
  "founderscafe",          // Founders Cafe
  "indie-hackers",         // Indie Hackers
];

// ---------------------------------------------------------------------------
// Extended LumaEntry interface — includes host and calendar info
// ---------------------------------------------------------------------------
interface LumaHost {
  name?: string;
  api_id?: string;
  username?: string;
  linkedin_handle?: string;
  twitter_handle?: string;
  website?: string;
  bio_short?: string;
  avatar_url?: string;
}

interface LumaCalendar {
  name?: string;
  api_id?: string;
  slug?: string;
  geo_city?: string;
  linkedin_handle?: string;
  description_short?: string;
}

interface LumaEntry {
  event?: {
    api_id?: string;
    name?: string;
    description?: string;
    start_at?: string;
    end_at?: string;
    url?: string;
    cover_url?: string;
    geo_address_info?: {
      full_address?: string;
      city?: string;
      address?: string;
      localized?: Record<string, { full_address?: string }>;
    };
  };
  cover_image?: { url?: string };
  hosts?: LumaHost[];
  calendar?: LumaCalendar;
}

// Extended FounderEvent with organizer details for internal use
export interface LumaFounderEvent extends FounderEvent {
  organizerName?: string;
  organizerLumaId?: string;
  organizerLinkedin?: string;
  organizerUsername?: string;
  organizerAvatarUrl?: string;
  organizerWebsite?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Parse a raw Luma entry into a FounderEvent (with organizer info)
// ---------------------------------------------------------------------------
function parseEntry(entry: LumaEntry, fallbackCity: string): LumaFounderEvent | null {
  const e = entry.event;
  if (!e?.name) return null;

  const title = e.name.slice(0, 200);
  const description = (e.description ?? "").replace(/<[^>]*>/g, "").slice(0, 800);
  const geo = e.geo_address_info;
  const location =
    geo?.localized?.["en-GB"]?.full_address ??
    geo?.localized?.["en"]?.full_address ??
    geo?.full_address ??
    geo?.address ??
    geo?.city ??
    fallbackCity;

  const id = `luma-${e.api_id ?? hashString(title)}`;

  // Build URL: prefer the human-readable slug
  // Luma resolves: lu.ma/<slug> for slugs, lu.ma/event/<api_id> for API IDs
  // lu.ma/evt-xxxxx does NOT work — must use lu.ma/event/evt-xxxxx
  let url: string;
  if (e.url && e.url.startsWith("http")) {
    url = e.url;
  } else if (e.url && e.url.length > 3 && !e.url.startsWith("evt-")) {
    // Valid human-readable slug
    url = `https://lu.ma/${e.url}`;
  } else if (e.api_id) {
    // API ID like evt-xxxxx — use /event/ path which Luma resolves
    url = `https://lu.ma/event/${e.api_id}`;
  } else if (e.url) {
    // evt- prefixed url field — also use /event/ path
    url = `https://lu.ma/event/${e.url}`;
  } else {
    url = `https://lu.ma/discover`;
  }

  // Extract primary host info
  const primaryHost = entry.hosts?.[0];
  const organizerName = primaryHost?.name ?? entry.calendar?.name ?? undefined;
  const organizerLumaId = primaryHost?.api_id ?? undefined;
  const organizerLinkedin = primaryHost?.linkedin_handle ?? entry.calendar?.linkedin_handle ?? undefined;
  const organizerUsername = primaryHost?.username ?? entry.calendar?.slug ?? undefined;
  const organizerAvatarUrl = primaryHost?.avatar_url ?? undefined;
  const organizerWebsite = primaryHost?.website ?? undefined;

  return {
    id,
    title,
    description,
    date: e.start_at ?? "",
    endDate: e.end_at ?? undefined,
    location: (location ?? "").slice(0, 300),
    url,
    source: "luma",
    category: categorizeEvent(title, description),
    imageUrl: entry.cover_image?.url ?? e.cover_url ?? undefined,
    organizerName,
    organizerLumaId,
    organizerLinkedin,
    organizerUsername,
    organizerAvatarUrl,
    organizerWebsite,
  };
}

// ---------------------------------------------------------------------------
// Paginate through Luma's place API to get ALL city events
// ---------------------------------------------------------------------------
async function paginatePlaceApi(
  placeApiId: string,
  initialCursor: string | null,
  fallbackCity: string
): Promise<LumaFounderEvent[]> {
  const events: LumaFounderEvent[] = [];
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() + 1);

  let cursor = initialCursor;
  let page = 0;
  const MAX_PAGES = 8;

  while (page < MAX_PAGES) {
    page++;
    try {
      const params = new URLSearchParams({
        placeApiId,
        pagination_limit: "50",
        ...(cursor ? { pagination_cursor: cursor } : {}),
      });

      const res = await fetch(
        `https://api.lu.ma/api/v1/place/get-items?${params}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            "x-luma-web-url": `https://lu.ma/${fallbackCity}`,
          },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!res.ok) break;
      const data = await res.json() as Record<string, unknown>;
      const entries = Array.isArray(data.entries) ? (data.entries as LumaEntry[]) : [];

      if (entries.length === 0) break;

      for (const entry of entries) {
        const evt = parseEntry(entry, fallbackCity);
        if (evt) events.push(evt);
      }

      const last = entries[entries.length - 1];
      if (last?.event?.start_at && new Date(last.event.start_at) > cutoff) break;

      cursor = typeof data.next_cursor === "string" ? data.next_cursor : null;
      if (!cursor || data.has_more === false) break;
    } catch {
      break;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Scrape a city page: __NEXT_DATA__ + paginate via place API
// ---------------------------------------------------------------------------
async function fetchCity(citySlug: string): Promise<LumaFounderEvent[]> {
  const allEvents: LumaFounderEvent[] = [];

  try {
    const res = await fetch(`https://lu.ma/${citySlug}`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(14_000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) return [];

    const nextData = JSON.parse(match[1]);
    const pageData = nextData?.props?.pageProps?.initialData?.data ?? {};

    const initialEntries: LumaEntry[] = Array.isArray(pageData.events) ? pageData.events : [];
    for (const entry of initialEntries) {
      const evt = parseEntry(entry, citySlug);
      if (evt) allEvents.push(evt);
    }

    const placeApiId: string | undefined =
      pageData?.place?.api_id ??
      pageData?.api_id;

    if (placeApiId) {
      const cursor: string | null = typeof pageData.next_cursor === "string"
        ? pageData.next_cursor
        : null;
      const more = await paginatePlaceApi(placeApiId, cursor, citySlug);
      allEvents.push(...more);
    }
  } catch {
    // fail silently
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Paginate through Luma's calendar API to get all community events
// ---------------------------------------------------------------------------
async function paginateCalendarApi(
  calendarApiId: string,
  fallbackName: string
): Promise<LumaFounderEvent[]> {
  const events: LumaFounderEvent[] = [];
  let cursor: string | null = null;
  let page = 0;
  const MAX_PAGES = 5;

  while (page < MAX_PAGES) {
    page++;
    try {
      const params = new URLSearchParams({
        calendarApiId,
        pagination_limit: "50",
        ...(cursor ? { pagination_cursor: cursor } : {}),
      });

      const res = await fetch(
        `https://api.lu.ma/api/v1/calendar/get-items?${params}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!res.ok) break;
      const data = await res.json() as Record<string, unknown>;
      const entries = Array.isArray(data.entries) ? (data.entries as LumaEntry[]) : [];

      if (entries.length === 0) break;

      for (const entry of entries) {
        const evt = parseEntry(entry, fallbackName);
        if (evt) events.push(evt);
      }

      cursor = typeof data.next_cursor === "string" ? data.next_cursor : null;
      if (!cursor || data.has_more === false) break;
    } catch {
      break;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Scrape a community/organizer page and paginate via calendar API
// ---------------------------------------------------------------------------
async function fetchCommunity(slug: string): Promise<LumaFounderEvent[]> {
  const allEvents: LumaFounderEvent[] = [];

  try {
    const res = await fetch(`https://lu.ma/${slug}`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) return [];

    const nextData = JSON.parse(match[1]);
    const pageData = nextData?.props?.pageProps?.initialData?.data ?? {};

    const initialEntries: LumaEntry[] = Array.isArray(pageData.events)
      ? pageData.events
      : Array.isArray(pageData.event_list)
      ? pageData.event_list
      : [];

    for (const entry of initialEntries) {
      const evt = parseEntry(entry, slug);
      if (evt) allEvents.push(evt);
    }

    const calendarApiId: string | undefined =
      pageData?.calendar?.api_id ??
      pageData?.community?.calendar_api_id ??
      pageData?.host?.calendar_api_id ??
      pageData?.api_id;

    if (calendarApiId) {
      const more = await paginateCalendarApi(calendarApiId, slug);
      allEvents.push(...more);
    }
  } catch {
    // Community page may not exist — fail silently
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Official Luma API (requires LUMA_API_KEY — optional bonus source)
// ---------------------------------------------------------------------------
async function fetchFromOfficialAPI(): Promise<LumaFounderEvent[]> {
  const apiKey = process.env.LUMA_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      "https://public-api.luma.com/v1/calendar/list-events?pagination_limit=100",
      {
        headers: { "x-luma-api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return [];

    const data = await res.json() as Record<string, unknown>;
    const entries: unknown[] = Array.isArray(data.entries) ? data.entries : [];

    const events: LumaFounderEvent[] = [];
    for (const raw of entries) {
      try {
        const entry = raw as Record<string, unknown>;
        const evt = (typeof entry.event === "object" && entry.event ? entry.event : entry) as Record<string, unknown>;
        const title = (evt.name as string) || (evt.title as string) || "";
        if (!title) continue;

        const id = (evt.api_id as string) || (evt.id as string) || hashString(title);
        const rawSlug = (evt.url as string) || "";
        let eventUrl: string;
        if (rawSlug.startsWith("http")) {
          eventUrl = rawSlug;
        } else if (rawSlug && !rawSlug.startsWith("evt-")) {
          eventUrl = `https://lu.ma/${rawSlug}`;
        } else {
          // evt- prefixed or raw api_id — use /event/ path
          eventUrl = `https://lu.ma/event/${rawSlug || id}`;
        }

        events.push({
          id: `luma-official-${id}`,
          title,
          description: ((evt.description as string) || "").slice(0, 500),
          date: (evt.start_at as string) || "",
          endDate: (evt.end_at as string) || undefined,
          location: extractLocation(evt) || "London",
          url: eventUrl,
          source: "luma",
          category: categorizeEvent(title, (evt.description as string) || ""),
          imageUrl: (evt.cover_url as string) || undefined,
        });
      } catch { /* skip */ }
    }
    return events;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractLocation(record: Record<string, unknown>): string {
  if (typeof record.geo_address_info === "object" && record.geo_address_info) {
    const geo = record.geo_address_info as Record<string, unknown>;
    if (typeof geo.full_address === "string") return geo.full_address;
    if (typeof geo.city === "string") return geo.city;
  }
  if (typeof record.location === "string") return record.location;
  if (typeof record.address === "string") return record.address;
  return "";
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36);
}

function dedup(events: LumaFounderEvent[]): LumaFounderEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() + 1);

    const cityEvents: LumaFounderEvent[] = [];
    for (let i = 0; i < CITY_SLUGS.length; i += 5) {
      const batch = CITY_SLUGS.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(fetchCity));
      for (const r of results) {
        if (r.status === "fulfilled") cityEvents.push(...r.value);
      }
    }

    const communityEvents: LumaFounderEvent[] = [];
    for (let i = 0; i < COMMUNITY_SLUGS.length; i += 6) {
      const batch = COMMUNITY_SLUGS.slice(i, i + 6);
      const results = await Promise.allSettled(batch.map(fetchCommunity));
      for (const r of results) {
        if (r.status === "fulfilled") communityEvents.push(...r.value);
      }
    }

    const officialEvents = await fetchFromOfficialAPI();

    const all = [...cityEvents, ...communityEvents, ...officialEvents];

    const filtered = dedup(all).filter((e) => {
      if (!e.title || !e.date) return false;
      const d = new Date(e.date);
      return d >= now && d <= cutoff;
    });

    filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({
      events: filtered,
      count: filtered.length,
      source: "luma",
      cities: CITY_SLUGS.length,
      communities: COMMUNITY_SLUGS.length,
      breakdown: {
        city: cityEvents.length,
        community: communityEvents.length,
        official: officialEvents.length,
        deduped: all.length - filtered.length,
      },
    });
  } catch (error) {
    console.error("Luma route error:", error);
    return NextResponse.json({ events: [], count: 0, source: "luma" });
  }
}
