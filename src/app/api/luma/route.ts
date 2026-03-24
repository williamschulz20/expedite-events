import { NextResponse } from "next/server";
import {
  FounderEvent,
  isRelevantEvent,
  categorizeEvent,
} from "@/lib/types";

// Luma API / scraping configuration
const LONDON_LAT = 51.5074;
const LONDON_LNG = -0.1278;
const GEO_RADIUS = "30km";

const SEARCH_TERMS = [
  "founder",
  "startup",
  "tech",
  "pitch",
  "hackathon",
  "networking",
  "demo day",
  "investor",
  "AI",
  "venture capital",
  "fintech",
  "SaaS",
  "entrepreneur",
  "accelerator",
  "seed",
  "fundraising",
];

// ---------------------------------------------------------------------------
// Strategy 1: Luma paginated discover API
// ---------------------------------------------------------------------------
async function fetchFromDiscoverAPI(): Promise<FounderEvent[]> {
  const allEvents: FounderEvent[] = [];
  const now = new Date();
  const threeMonths = new Date(now);
  threeMonths.setMonth(threeMonths.getMonth() + 3);

  // Fetch multiple pages to cover 3 months
  for (let page = 0; page < 3; page++) {
    const url = new URL("https://api.lu.ma/discover/get-paginated-events");
    url.searchParams.set("geo_latitude", String(LONDON_LAT));
    url.searchParams.set("geo_longitude", String(LONDON_LNG));
    url.searchParams.set("geo_radius", GEO_RADIUS);
    url.searchParams.set("pagination_limit", "100");
    if (page > 0) url.searchParams.set("pagination_offset", String(page * 100));

    try {
      const res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) break;

      const data = await res.json();
      const pageEvents = parseLumaAPIResponse(data);
      allEvents.push(...pageEvents);
      if (pageEvents.length < 50) break; // no more pages
    } catch {
      break;
    }
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Strategy 2: Luma public search API
// ---------------------------------------------------------------------------
async function fetchFromSearchAPI(): Promise<FounderEvent[]> {
  const allEvents: FounderEvent[] = [];
  const seenIds = new Set<string>();

  for (const term of SEARCH_TERMS) {
    try {
      const url = new URL("https://api.lu.ma/public/v2/event/search");
      url.searchParams.set("query", term);
      url.searchParams.set("geo_latitude", String(LONDON_LAT));
      url.searchParams.set("geo_longitude", String(LONDON_LNG));
      url.searchParams.set("geo_radius", GEO_RADIUS);

      const res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const events = parseLumaAPIResponse(data);
      for (const evt of events) {
        if (!seenIds.has(evt.id)) {
          seenIds.add(evt.id);
          allEvents.push(evt);
        }
      }
    } catch {
      // Skip failed search terms
    }
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Strategy 3: Scrape Luma discover page for London
// ---------------------------------------------------------------------------
async function scrapeDiscoverPage(): Promise<FounderEvent[]> {
  const allEvents: FounderEvent[] = [];
  const seenIds = new Set<string>();

  const urls = [
    "https://lu.ma/discover/london",
    ...SEARCH_TERMS.slice(0, 3).map(
      (term) =>
        `https://lu.ma/discover?query=${encodeURIComponent(term)}&near=London`
    ),
  ];

  for (const pageUrl of urls) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          Accept: "text/html",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) continue;

      const html = await res.text();
      const events = parseHTML(html);
      for (const evt of events) {
        if (!seenIds.has(evt.id)) {
          seenIds.add(evt.id);
          allEvents.push(evt);
        }
      }
    } catch {
      // Skip failed pages
    }
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Strategy 4: Scrape Luma's Next.js data payload (__NEXT_DATA__)
// ---------------------------------------------------------------------------
async function scrapeNextData(): Promise<FounderEvent[]> {
  try {
    const res = await fetch("https://lu.ma/discover/london", {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];

    const html = await res.text();

    // Look for __NEXT_DATA__ or embedded JSON data
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!nextDataMatch) return [];

    const nextData = JSON.parse(nextDataMatch[1]);
    const events: FounderEvent[] = [];

    // Traverse the Next.js data looking for event-like objects
    const extractEvents = (obj: unknown, depth = 0): void => {
      if (depth > 10 || !obj || typeof obj !== "object") return;

      if (Array.isArray(obj)) {
        for (const item of obj) extractEvents(item, depth + 1);
        return;
      }

      const record = obj as Record<string, unknown>;

      // Look for objects with event-like properties
      if (
        typeof record.name === "string" &&
        (typeof record.start_at === "string" ||
          typeof record.event_id === "string" ||
          typeof record.url === "string")
      ) {
        const title = (record.name as string) || "";
        const description = (record.description as string) || "";
        const id =
          (record.event_id as string) ||
          (record.api_id as string) ||
          (record.id as string) ||
          title.toLowerCase().replace(/\s+/g, "-");

        if (title && isRelevantEvent(title, description)) {
          const slug = (record.url as string) || id;
          events.push({
            id: `luma-${id}`,
            title,
            description: description.slice(0, 500),
            date: (record.start_at as string) || "",
            endDate: (record.end_at as string) || undefined,
            location:
              extractLocation(record) || "London",
            url: slug.startsWith("http")
              ? slug
              : `https://lu.ma/${slug}`,
            source: "luma",
            category: categorizeEvent(title, description),
            imageUrl: (record.cover_url as string) || undefined,
          });
        }
      }

      // Recurse into all values
      for (const val of Object.values(record)) {
        extractEvents(val, depth + 1);
      }
    };

    extractEvents(nextData);
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
  if (typeof record.geo_address === "string") return record.geo_address;
  return "";
}

/** Parse a Luma API JSON response into FounderEvent[] */
function parseLumaAPIResponse(data: unknown): FounderEvent[] {
  const events: FounderEvent[] = [];
  if (!data || typeof data !== "object") return events;

  const record = data as Record<string, unknown>;

  // Luma wraps events in different shapes — try common structures
  const entries: unknown[] = [];
  if (Array.isArray(record.data)) entries.push(...record.data);
  if (Array.isArray(record.events)) entries.push(...record.events);
  if (Array.isArray(record.entries)) entries.push(...record.entries);
  if (Array.isArray(record.results)) entries.push(...record.results);

  for (const raw of entries) {
    try {
      const entry = raw as Record<string, unknown>;
      // Event may be nested under entry.event
      const evt = (
        typeof entry.event === "object" && entry.event
          ? entry.event
          : entry
      ) as Record<string, unknown>;

      const title = (evt.name as string) || (evt.title as string) || "";
      const description =
        (evt.description as string) ||
        (evt.description_short as string) ||
        "";

      if (!title) continue;
      if (!isRelevantEvent(title, description)) continue;

      const id =
        (evt.api_id as string) ||
        (evt.event_id as string) ||
        (evt.id as string) ||
        title.toLowerCase().replace(/\s+/g, "-");
      const slug = (evt.url as string) || id;

      events.push({
        id: `luma-${id}`,
        title,
        description: description.slice(0, 500),
        date: (evt.start_at as string) || (evt.date as string) || "",
        endDate: (evt.end_at as string) || undefined,
        location: extractLocation(evt) || "London",
        url: slug.startsWith("http") ? slug : `https://lu.ma/${slug}`,
        source: "luma",
        category: categorizeEvent(title, description),
        imageUrl:
          (evt.cover_url as string) ||
          (evt.image_url as string) ||
          undefined,
      });
    } catch {
      // Skip malformed entries
    }
  }

  return events;
}

/** Parse HTML from Luma discover pages to extract event data */
function parseHTML(html: string): FounderEvent[] {
  const events: FounderEvent[] = [];

  // Try JSON-LD structured data first
  const jsonLdBlocks = html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  );
  for (const match of jsonLdBlocks) {
    try {
      const ld = JSON.parse(match[1]);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (item["@type"] === "Event" && item.name) {
          const title = item.name || "";
          const description = item.description || "";
          if (!isRelevantEvent(title, description)) continue;

          events.push({
            id: `luma-${(item.url || title).replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            title,
            description: description.slice(0, 500),
            date: item.startDate || "",
            endDate: item.endDate || undefined,
            location:
              item.location?.name ||
              item.location?.address?.addressLocality ||
              "London",
            url: item.url || "",
            source: "luma",
            category: categorizeEvent(title, description),
            imageUrl: item.image || undefined,
          });
        }
      }
    } catch {
      // Skip malformed JSON-LD
    }
  }

  // Fallback: extract event cards from HTML using regex patterns
  // Luma event cards typically have links like /event-slug and contain event info
  const cardPattern =
    /href="\/([a-z0-9][\w-]*)"[^>]*>[\s\S]*?<[^>]*class="[^"]*event[^"]*"[\s\S]*?<\/a>/gi;
  const cards = html.matchAll(cardPattern);
  for (const card of cards) {
    const slug = card[1];
    const cardHtml = card[0];

    // Extract title — usually in a prominent element
    const titleMatch = cardHtml.match(
      /<(?:h[1-6]|div|span|p)[^>]*class="[^"]*(?:title|name|heading)[^"]*"[^>]*>([\s\S]*?)<\//
    );
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]*>/g, "").trim()
      : "";
    if (!title) continue;

    // Extract date
    const dateMatch = cardHtml.match(
      /(?:datetime|data-date)="([^"]+)"/
    );
    const dateStr = dateMatch ? dateMatch[1] : "";

    const description = "";
    if (!isRelevantEvent(title, description)) continue;

    events.push({
      id: `luma-${slug}`,
      title,
      description,
      date: dateStr,
      location: "London",
      url: `https://lu.ma/${slug}`,
      source: "luma",
      category: categorizeEvent(title, description),
    });
  }

  // Also try extracting from embedded application state / Apollo cache / props
  const statePattern =
    /"name"\s*:\s*"([^"]+)"[\s\S]*?"start_at"\s*:\s*"([^"]+)"/g;
  const stateMatches = html.matchAll(statePattern);
  for (const m of stateMatches) {
    const title = m[1];
    const date = m[2];
    if (!isRelevantEvent(title, "")) continue;

    const id = title.toLowerCase().replace(/\s+/g, "-");
    if (events.some((e) => e.id === `luma-${id}`)) continue;

    events.push({
      id: `luma-${id}`,
      title,
      description: "",
      date,
      location: "London",
      url: `https://lu.ma/discover/london`,
      source: "luma",
      category: categorizeEvent(title, ""),
    });
  }

  return events;
}

/** De-duplicate events by id */
function dedup(events: FounderEvent[]): FounderEvent[] {
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
    // Run all strategies concurrently; use whatever succeeds
    const [discoverResults, searchResults, scrapeResults, nextDataResults] =
      await Promise.allSettled([
        fetchFromDiscoverAPI(),
        fetchFromSearchAPI(),
        scrapeDiscoverPage(),
        scrapeNextData(),
      ]);

    const all: FounderEvent[] = [];

    if (discoverResults.status === "fulfilled")
      all.push(...discoverResults.value);
    if (searchResults.status === "fulfilled")
      all.push(...searchResults.value);
    if (scrapeResults.status === "fulfilled")
      all.push(...scrapeResults.value);
    if (nextDataResults.status === "fulfilled")
      all.push(...nextDataResults.value);

    const events = dedup(all);

    // Fetch descriptions for events that don't have them (up to 20)
    const needsDescription = events.filter((e) => !e.description).slice(0, 20);
    if (needsDescription.length > 0) {
      const detailResults = await Promise.allSettled(
        needsDescription.map(async (e) => {
          try {
            const slug = e.url.replace("https://lu.ma/", "");
            const res = await fetch(`https://lu.ma/${slug}`, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
              },
              signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok) return;
            const html = await res.text();

            // Extract description from meta tags
            const descMatch = html.match(
              /<meta[^>]*(?:name="description"|property="og:description")[^>]*content="([^"]*)"[^>]*>/i
            );
            if (descMatch) {
              e.description = descMatch[1].slice(0, 500);
            }

            // Also extract full address if we only have "London"
            if (e.location === "London") {
              const locMatch = html.match(
                /<meta[^>]*property="og:location"[^>]*content="([^"]*)"[^>]*>/i
              );
              if (locMatch) e.location = locMatch[1];
            }
          } catch {
            // skip
          }
        })
      );
      // results applied in-place via mutation
    }

    // Sort by date ascending
    events.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return NextResponse.json({
      events,
      count: events.length,
      source: "luma",
    });
  } catch (error) {
    console.error("Luma route error:", error);
    return NextResponse.json({ events: [], count: 0, source: "luma" });
  }
}
