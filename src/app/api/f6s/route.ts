import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// F6S event scraper
// Fetches upcoming events from f6s.com search pages, parsing HTML for event
// cards, JSON-LD, or link patterns like /event/<slug>.
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

const CITIES = [
  "London", "Berlin", "Paris", "Amsterdam", "San Francisco", "Tallinn",
  "Stockholm", "Helsinki", "Dublin", "Lisbon", "Barcelona", "Zurich",
  "Vienna", "Warsaw", "Munich", "New York",
];

const CONCURRENCY = 4;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};

// ---------------------------------------------------------------------------
// Parse events from HTML
// ---------------------------------------------------------------------------
interface RawEvent {
  title: string;
  url: string;
  date: string;
  location: string;
}

function parseJsonLd(html: string): RawEvent[] {
  const events: RawEvent[] = [];
  const jsonLdMatches: RegExpExecArray[] = [];
  const jsonLdRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdM: RegExpExecArray | null;
  while ((jsonLdM = jsonLdRe.exec(html)) !== null) {
    jsonLdMatches.push(jsonLdM);
  }
  for (const match of jsonLdMatches) {
    try {
      const ld = JSON.parse(match[1]);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (
          (item["@type"] === "Event" || item["@type"] === "BusinessEvent") &&
          item.name
        ) {
          const loc =
            typeof item.location === "string"
              ? item.location
              : item.location?.name ?? item.location?.address?.addressLocality ?? "";
          events.push({
            title: item.name,
            url: item.url ?? "",
            date: item.startDate ?? "",
            location: loc,
          });
        }
      }
    } catch {
      /* skip malformed JSON-LD */
    }
  }
  return events;
}

function parseEventLinks(html: string, city: string): RawEvent[] {
  const events: RawEvent[] = [];
  // Match links to /event/<slug> with surrounding context for title
  const linkPattern =
    /href="((?:https?:\/\/(?:www\.)?f6s\.com)?\/event\/([^"]+))"/gi;
  let m: RegExpExecArray | null;

  while ((m = linkPattern.exec(html)) !== null) {
    const href = m[1].startsWith("http")
      ? m[1]
      : `https://www.f6s.com${m[1]}`;
    const slug = m[2];
    // Convert slug to readable title
    const title = slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Try to find a date near this link (within 500 chars after)
    const afterLink = html.substring(m.index, m.index + 800);
    const dateMatch = afterLink.match(
      /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i
    ) ?? afterLink.match(
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i
    );

    let date = "";
    if (dateMatch) {
      date = parseDateFromMatch(dateMatch);
    }

    events.push({
      title,
      url: href,
      date,
      location: city,
    });
  }

  return events;
}

function parseEventCards(html: string, city: string): RawEvent[] {
  const events: RawEvent[] = [];

  // F6S uses card-like structures with titles in h3/h4/a tags
  // Pattern: look for event titles near links
  const cardPattern =
    /<(?:h[2-4]|a)[^>]*class="[^"]*(?:event|card|title)[^"]*"[^>]*>([^<]+)<\/(?:h[2-4]|a)>/gi;
  let m: RegExpExecArray | null;

  while ((m = cardPattern.exec(html)) !== null) {
    const title = m[1].trim();
    if (!title || title.length < 3) continue;

    // Look for a link near this card
    const surrounding = html.substring(
      Math.max(0, m.index - 300),
      m.index + 500
    );
    const linkMatch = surrounding.match(
      /href="((?:https?:\/\/(?:www\.)?f6s\.com)?\/event\/[^"]+)"/i
    );
    const url = linkMatch
      ? linkMatch[1].startsWith("http")
        ? linkMatch[1]
        : `https://www.f6s.com${linkMatch[1]}`
      : "";

    // Try to find date
    const dateMatch = surrounding.match(
      /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i
    );
    const date = dateMatch ? parseDateFromMatch(dateMatch) : "";

    events.push({ title, url, date, location: city });
  }

  return events;
}

function parseDateFromMatch(m: RegExpMatchArray): string {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  // Two formats: "15 Jan 2026" or "Jan 15, 2026"
  let day: string;
  let month: string;
  let year: string;

  if (/^\d/.test(m[1])) {
    // "15 Jan 2026"
    day = m[1].padStart(2, "0");
    month = months[m[2].toLowerCase().substring(0, 3)] ?? "01";
    year = m[3];
  } else {
    // "Jan 15, 2026"
    month = months[m[1].toLowerCase().substring(0, 3)] ?? "01";
    day = m[2].padStart(2, "0");
    year = m[3];
  }

  return `${year}-${month}-${day}T09:00:00Z`;
}

// ---------------------------------------------------------------------------
// Fetch and parse a single city page
// ---------------------------------------------------------------------------
async function fetchCity(city: string): Promise<FounderEvent[]> {
  const encodedCity = encodeURIComponent(city);
  const url = `https://www.f6s.com/events?type=event&location=${encodedCity}&when=upcoming`;

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Try multiple parsing strategies, merge results
    const fromJsonLd = parseJsonLd(html);
    const fromLinks = parseEventLinks(html, city);
    const fromCards = parseEventCards(html, city);

    // Merge all, deduplicate by URL
    const seen = new Set<string>();
    const rawEvents: RawEvent[] = [];

    for (const list of [fromJsonLd, fromLinks, fromCards]) {
      for (const ev of list) {
        const key = ev.url || ev.title;
        if (!seen.has(key)) {
          seen.add(key);
          rawEvents.push(ev);
        }
      }
    }

    return rawEvents.map((raw) => {
      const description = `F6S event in ${raw.location || city}`;
      return {
        id: `f6s-${hashString(raw.title + (raw.date || city))}`,
        title: raw.title,
        description,
        date: raw.date,
        location: raw.location || city,
        url: raw.url || url,
        source: "luma" as const,
        category: categorizeEvent(raw.title, description),
      };
    });
  } catch {
    // Timeout, network error, etc.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Batch runner — 4 concurrent fetches at a time
// ---------------------------------------------------------------------------
async function fetchAllCities(): Promise<FounderEvent[]> {
  const allEvents: FounderEvent[] = [];

  for (let i = 0; i < CITIES.length; i += CONCURRENCY) {
    const batch = CITIES.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchCity));

    for (const r of results) {
      if (r.status === "fulfilled") {
        allEvents.push(...r.value);
      }
    }
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const rawEvents = await fetchAllCities();

  // Deduplicate globally by id
  const seen = new Set<string>();
  const events: FounderEvent[] = [];
  for (const ev of rawEvents) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      events.push(ev);
    }
  }

  // Sort by date ascending (undated events at the end)
  events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return NextResponse.json({ events, count: events.length, source: "f6s" });
}
