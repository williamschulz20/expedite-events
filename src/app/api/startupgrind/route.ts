import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Startup Grind scraper
// Fetches events from startupgrind.com main page + chapter pages
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Chapter slugs — key cities with Startup Grind chapters
// ---------------------------------------------------------------------------
const CHAPTER_SLUGS = [
  "london",
  "berlin",
  "paris",
  "amsterdam",
  "san-francisco",
  "los-angeles",
  "new-york",
  "tallinn",
  "stockholm",
  "helsinki",
  "lisbon",
  "barcelona",
  "munich",
  "zurich",
  "vienna",
  "dublin",
  "austin",
  "boston",
];

// City display names for location fallback
const CITY_NAMES: Record<string, string> = {
  "london": "London",
  "berlin": "Berlin",
  "paris": "Paris",
  "amsterdam": "Amsterdam",
  "san-francisco": "San Francisco",
  "los-angeles": "Los Angeles",
  "new-york": "New York",
  "tallinn": "Tallinn",
  "stockholm": "Stockholm",
  "helsinki": "Helsinki",
  "lisbon": "Lisbon",
  "barcelona": "Barcelona",
  "munich": "Munich",
  "zurich": "Zurich",
  "vienna": "Vienna",
  "dublin": "Dublin",
  "austin": "Austin",
  "boston": "Boston",
};

// ---------------------------------------------------------------------------
// Parse JSON-LD from HTML
// ---------------------------------------------------------------------------
function parseJsonLd(html: string, city: string): FounderEvent[] {
  const events: FounderEvent[] = [];

  const jsonLdRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // Handle @graph arrays (common in Startup Grind pages)
        const candidates =
          item["@graph"] && Array.isArray(item["@graph"])
            ? item["@graph"]
            : [item];

        for (const candidate of candidates) {
          if (
            candidate["@type"] !== "Event" &&
            candidate["@type"] !== "SocialEvent" &&
            candidate["@type"] !== "BusinessEvent"
          )
            continue;

          const title = (candidate.name ?? "").slice(0, 200);
          if (!title) continue;

          const description = (candidate.description ?? "")
            .replace(/<[^>]*>/g, "")
            .slice(0, 800);

          let location = city;
          if (candidate.location) {
            if (typeof candidate.location === "string") {
              location = candidate.location;
            } else if (candidate.location.name) {
              location = candidate.location.name;
              if (candidate.location.address?.addressLocality) {
                location += `, ${candidate.location.address.addressLocality}`;
              }
            } else if (candidate.location.address?.addressLocality) {
              location = candidate.location.address.addressLocality;
            }
          }

          const url =
            candidate.url ??
            candidate.sameAs ??
            `https://www.startupgrind.com/${city}/`;

          events.push({
            id: `sg-${hashString(title + (candidate.startDate ?? ""))}`,
            title,
            description,
            date: candidate.startDate
              ? new Date(candidate.startDate).toISOString()
              : "",
            endDate: candidate.endDate
              ? new Date(candidate.endDate).toISOString()
              : undefined,
            location: location.slice(0, 300),
            url: url.startsWith("http")
              ? url
              : `https://www.startupgrind.com${url.startsWith("/") ? "" : "/"}${url}`,
            source: "startupgrind",
            category: categorizeEvent(title, description),
          });
        }
      }
    } catch {
      // Invalid JSON-LD — skip
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Parse event cards from Startup Grind HTML
// ---------------------------------------------------------------------------
function parseEventCards(html: string, city: string): FounderEvent[] {
  const events: FounderEvent[] = [];
  const seenTitles = new Set<string>();

  // Date patterns
  const dateRegex =
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{4})/gi;
  const isoDateRegex = /(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?)/g;

  // Pattern 1: Event card blocks — Startup Grind uses various class patterns
  const eventBlockRegex =
    /<(?:div|article|section|li)[^>]*class=["'][^"']*(?:event|card|listing|upcoming|featured)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section|li)>/gi;

  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = eventBlockRegex.exec(html)) !== null) {
    const block = blockMatch[1];

    // Extract title from headings or prominent links
    const titleMatch = block.match(
      /<(?:h[1-6]|a)[^>]*>\s*([^<]{5,150})\s*<\/(?:h[1-6]|a)>/i
    );
    if (!titleMatch) continue;

    const title = titleMatch[1].trim().replace(/\s+/g, " ");
    if (!title || seenTitles.has(title.toLowerCase())) continue;
    seenTitles.add(title.toLowerCase());

    // Extract URL
    const urlMatch = block.match(
      /<a[^>]*href=["']((?:https?:\/\/[^"']+|\/[^"']+))["']/i
    );
    const rawUrl = urlMatch?.[1] ?? "";
    const url = rawUrl.startsWith("http")
      ? rawUrl
      : rawUrl
      ? `https://www.startupgrind.com${rawUrl}`
      : `https://www.startupgrind.com/${city}/`;

    // Extract date
    let date = "";
    let endDate: string | undefined;

    const isoMatch = isoDateRegex.exec(block);
    if (isoMatch) {
      try {
        date = new Date(isoMatch[1]).toISOString();
      } catch {
        // invalid
      }
      isoDateRegex.lastIndex = 0;
    } else {
      const humanMatch = dateRegex.exec(block);
      if (humanMatch) {
        try {
          date = new Date(humanMatch[1]).toISOString();
        } catch {
          // invalid
        }
        dateRegex.lastIndex = 0;
      }
    }

    // Extract description
    const descMatch = block.match(
      /<(?:p|span|div)[^>]*class=["'][^"']*(?:desc|summary|snippet|body|text)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|div)>/i
    );
    const description = descMatch
      ? descMatch[1].replace(/<[^>]*>/g, "").trim().slice(0, 800)
      : "";

    // Extract location
    const locMatch = block.match(
      /<(?:span|div|p)[^>]*class=["'][^"']*(?:venue|location|place|address|city)[^"']*["'][^>]*>([^<]+)<\//i
    );
    const location = locMatch
      ? locMatch[1].trim()
      : CITY_NAMES[city] ?? city;

    events.push({
      id: `sg-${hashString(title + date)}`,
      title,
      description,
      date,
      endDate,
      location: location.slice(0, 300),
      url,
      source: "startupgrind",
      category: categorizeEvent(title, description),
    });
  }

  // Pattern 2: Scan for Startup Grind event links with "/events/" in path
  const sgLinkRegex =
    /<a[^>]*href=["']((?:https?:\/\/www\.startupgrind\.com)?\/events\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = sgLinkRegex.exec(html)) !== null) {
    const href = linkMatch[1];
    const linkText = linkMatch[2].replace(/<[^>]*>/g, "").trim();

    if (
      linkText.length < 5 ||
      linkText.length > 150 ||
      seenTitles.has(linkText.toLowerCase())
    )
      continue;

    seenTitles.add(linkText.toLowerCase());

    const url = href.startsWith("http")
      ? href
      : `https://www.startupgrind.com${href}`;

    // Look for a date near this link
    const linkPos = linkMatch.index;
    const nearby = html.slice(
      Math.max(0, linkPos - 200),
      Math.min(html.length, linkPos + 500)
    );

    let date = "";
    const nearbyDateMatch = dateRegex.exec(nearby);
    if (nearbyDateMatch) {
      try {
        date = new Date(nearbyDateMatch[1]).toISOString();
      } catch {
        // invalid
      }
      dateRegex.lastIndex = 0;
    }

    events.push({
      id: `sg-${hashString(linkText + date)}`,
      title: linkText,
      description: "",
      date,
      location: CITY_NAMES[city] ?? city,
      url,
      source: "startupgrind",
      category: categorizeEvent(linkText, ""),
    });
  }

  // Pattern 3: Look for chapter-specific event links
  const chapterLinkRegex =
    /<a[^>]*href=["']((?:https?:\/\/www\.startupgrind\.com)?\/[a-z-]+\/events?\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  while ((linkMatch = chapterLinkRegex.exec(html)) !== null) {
    const href = linkMatch[1];
    const linkText = linkMatch[2].replace(/<[^>]*>/g, "").trim();

    if (
      linkText.length < 5 ||
      linkText.length > 150 ||
      seenTitles.has(linkText.toLowerCase())
    )
      continue;

    seenTitles.add(linkText.toLowerCase());

    const url = href.startsWith("http")
      ? href
      : `https://www.startupgrind.com${href}`;

    const linkPos = linkMatch.index;
    const nearby = html.slice(
      Math.max(0, linkPos - 200),
      Math.min(html.length, linkPos + 500)
    );

    let date = "";
    const nearbyDateMatch = dateRegex.exec(nearby);
    if (nearbyDateMatch) {
      try {
        date = new Date(nearbyDateMatch[1]).toISOString();
      } catch {
        // invalid
      }
      dateRegex.lastIndex = 0;
    }

    events.push({
      id: `sg-${hashString(linkText + date)}`,
      title: linkText,
      description: "",
      date,
      location: CITY_NAMES[city] ?? city,
      url,
      source: "startupgrind",
      category: categorizeEvent(linkText, ""),
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Fetch a single page
// ---------------------------------------------------------------------------
async function fetchPage(
  url: string,
  city: string
): Promise<FounderEvent[]> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-GB,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://www.google.com/",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    // Try JSON-LD first (most structured)
    const jsonLdEvents = parseJsonLd(html, city);

    // Then try event card patterns
    const cardEvents = parseEventCards(html, city);

    // Merge and deduplicate
    const seen = new Set<string>();
    const merged: FounderEvent[] = [];

    for (const evt of [...jsonLdEvents, ...cardEvents]) {
      if (!evt.title || seen.has(evt.id)) continue;
      seen.add(evt.id);
      merged.push(evt);
    }

    return merged;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Build list of URLs to scrape
// ---------------------------------------------------------------------------
function buildUrls(): { url: string; city: string }[] {
  const urls: { url: string; city: string }[] = [];

  // Main events page
  urls.push({ url: "https://www.startupgrind.com/events/", city: "global" });

  // Chapter pages
  for (const slug of CHAPTER_SLUGS) {
    urls.push({
      url: `https://www.startupgrind.com/${slug}/`,
      city: slug,
    });
    // Also try the chapter events sub-page
    urls.push({
      url: `https://www.startupgrind.com/${slug}/events/`,
      city: slug,
    });
  }

  return urls;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() + 1);

    const urlList = buildUrls();
    const allEvents: FounderEvent[] = [];

    // Batch 4 concurrent requests
    for (let i = 0; i < urlList.length; i += 4) {
      const batch = urlList.slice(i, i + 4);
      const results = await Promise.allSettled(
        batch.map(({ url, city }) => fetchPage(url, city))
      );
      for (const r of results) {
        if (r.status === "fulfilled") allEvents.push(...r.value);
      }
    }

    // Deduplicate by id
    const seen = new Set<string>();
    const events = allEvents.filter((e) => {
      if (!e.title || seen.has(e.id)) return false;
      seen.add(e.id);

      // Filter to future events within cutoff
      if (e.date) {
        const d = new Date(e.date);
        if (d < now || d > cutoff) return false;
      }

      return true;
    });

    // Sort by date ascending
    events.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return NextResponse.json({
      events,
      count: events.length,
      source: "startupgrind",
      chapters: CHAPTER_SLUGS.length,
    });
  } catch (error) {
    console.error("Startup Grind route error:", error);
    return NextResponse.json({
      events: [],
      count: 0,
      source: "startupgrind",
    });
  }
}
