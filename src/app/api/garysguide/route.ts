import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// GarysGuide regions to scrape
// ---------------------------------------------------------------------------
const REGIONS = [
  { slug: "sfbay", label: "San Francisco Bay Area" },
  { slug: "newyork", label: "New York City" },
  { slug: "losangeles", label: "Los Angeles" },
  { slug: "boston", label: "Boston" },
  { slug: "austin", label: "Austin" },
  { slug: "london", label: "London" },
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ---------------------------------------------------------------------------
// Parse JSON-LD structured data from HTML
// ---------------------------------------------------------------------------
function parseJsonLd(html: string, regionLabel: string): FounderEvent[] {
  const events: FounderEvent[] = [];
  const jsonLdPattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (item["@type"] !== "Event" && item["@type"] !== "SocialEvent") continue;

        const title = (item.name || "").trim();
        if (!title) continue;

        const url = (item.url || "").trim();
        const description = (item.description || "").replace(/<[^>]*>/g, "").slice(0, 800);
        const startDate = item.startDate || "";
        const endDate = item.endDate || undefined;

        const location =
          item.location?.name ||
          item.location?.address?.streetAddress ||
          item.location?.address?.addressLocality ||
          regionLabel;

        events.push({
          id: `gg-${hashString(url || title)}`,
          title: title.slice(0, 200),
          description,
          date: startDate,
          endDate,
          location: (location || "").slice(0, 300),
          url: url.startsWith("http") ? url : `https://www.garysguide.com${url}`,
          source: "luma",
          category: categorizeEvent(title, description),
        });
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Parse event cards from HTML via regex patterns
// ---------------------------------------------------------------------------
function parseEventCards(html: string, regionLabel: string): FounderEvent[] {
  const events: FounderEvent[] = [];

  // Pattern 1: event links with /events/ path — e.g. <a href="/events/abc123">Title</a>
  const eventLinkPattern =
    /<a[^>]*href\s*=\s*["'](\/events\/[a-zA-Z0-9_-]+(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = eventLinkPattern.exec(html)) !== null) {
    const path = match[1];
    const innerHtml = match[2];
    const title = innerHtml.replace(/<[^>]*>/g, "").trim();

    if (!title || title.length < 3 || title.length > 300) continue;

    const url = `https://www.garysguide.com${path}`;
    const id = `gg-${hashString(url)}`;

    // Skip if already captured
    if (events.some((e) => e.id === id)) continue;

    // Try to extract a date near this event card
    const dateStr = extractNearbyDate(html, match.index);

    events.push({
      id,
      title: title.slice(0, 200),
      description: "",
      date: dateStr,
      location: regionLabel,
      url,
      source: "luma",
      category: categorizeEvent(title, ""),
    });
  }

  // Pattern 2: broader event card blocks — look for structured divs/spans with dates
  const cardPattern =
    /<(?:div|article|li)[^>]*class\s*=\s*["'][^"']*event[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|li)>/gi;

  while ((match = cardPattern.exec(html)) !== null) {
    const block = match[1];

    // Extract title from first <a> with href containing /events/
    const titleMatch = block.match(
      /<a[^>]*href\s*=\s*["'](\/events\/[a-zA-Z0-9_-]+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!titleMatch) continue;

    const path = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]*>/g, "").trim();
    if (!title || title.length < 3) continue;

    const url = `https://www.garysguide.com${path}`;
    const id = `gg-${hashString(url)}`;

    if (events.some((e) => e.id === id)) continue;

    // Extract date from the block
    const dateStr = extractDateFromBlock(block);

    // Extract location/venue from the block
    const venue = extractVenueFromBlock(block) || regionLabel;

    events.push({
      id,
      title: title.slice(0, 200),
      description: "",
      date: dateStr,
      location: venue.slice(0, 300),
      url,
      source: "luma",
      category: categorizeEvent(title, ""),
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Date extraction helpers
// ---------------------------------------------------------------------------
function extractNearbyDate(html: string, matchIndex: number): string {
  // Look in the surrounding 500 chars for date patterns
  const start = Math.max(0, matchIndex - 300);
  const end = Math.min(html.length, matchIndex + 500);
  const context = html.slice(start, end);
  return extractDateFromBlock(context);
}

function extractDateFromBlock(block: string): string {
  const text = block.replace(/<[^>]*>/g, " ");

  // ISO date: 2026-04-15
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2}(?:T[\d:]+(?:[+-]\d{2}:?\d{2}|Z)?)?)/);
  if (isoMatch) return isoMatch[1];

  // US-style: April 15, 2026 / Apr 15, 2026
  const usMatch = text.match(
    /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/i
  );
  if (usMatch) {
    const parsed = new Date(usMatch[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  // Slash-style: 04/15/2026 or 15/04/2026
  const slashMatch = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  if (slashMatch) {
    const parsed = new Date(slashMatch[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return "";
}

function extractVenueFromBlock(block: string): string {
  // Look for common venue/location patterns
  const venueMatch = block.match(
    /(?:venue|location|where|place|at)\s*[:=]?\s*["']?([^<"'\n]{3,80})/i
  );
  if (venueMatch) return venueMatch[1].trim();
  return "";
}

// ---------------------------------------------------------------------------
// Fetch and parse a single region page
// ---------------------------------------------------------------------------
async function fetchRegion(
  slug: string,
  label: string
): Promise<FounderEvent[]> {
  try {
    const url = `https://www.garysguide.com/events?region=${slug}`;
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.garysguide.com/",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    // Strategy 1: JSON-LD structured data (most reliable)
    const jsonLdEvents = parseJsonLd(html, label);

    // Strategy 2: regex-based HTML parsing for event cards
    const cardEvents = parseEventCards(html, label);

    // Merge — JSON-LD takes priority, then fill in from card parsing
    const seenIds = new Set(jsonLdEvents.map((e) => e.id));
    const seenUrls = new Set(jsonLdEvents.map((e) => e.url));

    for (const evt of cardEvents) {
      if (!seenIds.has(evt.id) && !seenUrls.has(evt.url)) {
        jsonLdEvents.push(evt);
        seenIds.add(evt.id);
        seenUrls.add(evt.url);
      }
    }

    return jsonLdEvents;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Dedup by URL
// ---------------------------------------------------------------------------
function dedup(events: FounderEvent[]): FounderEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = e.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const allEvents: FounderEvent[] = [];

    // Batch requests — 3 concurrent at a time
    for (let i = 0; i < REGIONS.length; i += 3) {
      const batch = REGIONS.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map((r) => fetchRegion(r.slug, r.label))
      );
      for (const r of results) {
        if (r.status === "fulfilled") allEvents.push(...r.value);
      }
    }

    const filtered = dedup(allEvents).filter((e) => {
      if (!e.title) return false;
      return true;
    });

    // Sort by date (events with dates first, then undated)
    filtered.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return NextResponse.json({
      events: filtered,
      count: filtered.length,
      source: "garysguide",
    });
  } catch (error) {
    console.error("GarysGuide route error:", error);
    return NextResponse.json({ events: [], count: 0, source: "garysguide" });
  }
}
