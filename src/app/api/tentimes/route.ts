import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// 10times.com scraper
// Fetches tech & startup events from 10times.com city pages
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
// City slugs — 10times uses format: /technology/<city>-<country>
// ---------------------------------------------------------------------------
const CITY_SLUGS = [
  "london-gb",
  "berlin-de",
  "paris-fr",
  "amsterdam-nl",
  "san-francisco-us",
  "los-angeles-us",
  "new-york-us",
  "tallinn-ee",
  "stockholm-se",
  "helsinki-fi",
  "lisbon-pt",
  "barcelona-es",
  "munich-de",
  "zurich-ch",
  "vienna-at",
  "dublin-ie",
  "austin-us",
  "boston-us",
];

// Categories to scrape — technology + startups
const CATEGORIES = ["technology", "startups"];

// Build full URL list
function buildUrls(): { url: string; city: string }[] {
  const urls: { url: string; city: string }[] = [];
  for (const slug of CITY_SLUGS) {
    const city = slug.split("-")[0];
    for (const category of CATEGORIES) {
      urls.push({
        url: `https://10times.com/${category}/${slug}`,
        city: city.charAt(0).toUpperCase() + city.slice(1),
      });
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Parse JSON-LD from HTML
// ---------------------------------------------------------------------------
function parseJsonLd(html: string, city: string): FounderEvent[] {
  const events: FounderEvent[] = [];

  // Look for JSON-LD event data
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (item["@type"] === "Event" || item["@type"] === "BusinessEvent") {
          const title = (item.name ?? "").slice(0, 200);
          if (!title) continue;

          const description = (
            item.description ??
            item.disambiguatingDescription ??
            ""
          )
            .replace(/<[^>]*>/g, "")
            .slice(0, 800);

          const location =
            item.location?.name ??
            item.location?.address?.addressLocality ??
            city;

          const url = item.url ?? item.sameAs ?? "";

          events.push({
            id: `10t-${hashString(title + (item.startDate ?? ""))}`,
            title,
            description,
            date: item.startDate
              ? new Date(item.startDate).toISOString()
              : "",
            endDate: item.endDate
              ? new Date(item.endDate).toISOString()
              : undefined,
            location: (typeof location === "string" ? location : city).slice(
              0,
              300
            ),
            url: url.startsWith("http")
              ? url
              : url
              ? `https://10times.com${url.startsWith("/") ? "" : "/"}${url}`
              : "",
            source: "luma",
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
// Parse event cards from HTML using regex patterns
// ---------------------------------------------------------------------------
function parseEventCards(html: string, city: string): FounderEvent[] {
  const events: FounderEvent[] = [];

  // Pattern 1: Event listing cards with links and dates
  // 10times typically has event cards with <a href="/event-slug"> and date info
  const cardRegex =
    /<a[^>]*href=["'](\/[a-z0-9][a-z0-9-]*[a-z0-9])["'][^>]*>\s*([\s\S]*?)<\/a>/gi;
  const dateRegex =
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/gi;
  const dateRangeRegex =
    /(\d{1,2})\s*-\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/gi;

  // Pattern 2: Look for structured event data in table/list format
  // <td> or <div> with event title and associated date
  const eventBlockRegex =
    /<(?:div|td|li|article)[^>]*class=["'][^"']*(?:event|listing|card)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|td|li|article)>/gi;

  let blockMatch: RegExpExecArray | null;
  const seenTitles = new Set<string>();

  while ((blockMatch = eventBlockRegex.exec(html)) !== null) {
    const block = blockMatch[1];

    // Extract title from link or heading
    const titleMatch = block.match(
      /<(?:a|h[1-6])[^>]*>([^<]{5,100})<\/(?:a|h[1-6])>/i
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
      ? `https://10times.com${rawUrl}`
      : "";

    // Extract date
    let date = "";
    let endDate: string | undefined;

    const rangeMatch = dateRangeRegex.exec(block);
    if (rangeMatch) {
      const [, startDay, endDay, month, year] = rangeMatch;
      date = new Date(`${startDay} ${month} ${year}`).toISOString();
      endDate = new Date(`${endDay} ${month} ${year}`).toISOString();
      dateRangeRegex.lastIndex = 0;
    } else {
      const singleMatch = dateRegex.exec(block);
      if (singleMatch) {
        try {
          date = new Date(singleMatch[1]).toISOString();
        } catch {
          // invalid date
        }
        dateRegex.lastIndex = 0;
      }
    }

    // Extract description snippet
    const descMatch = block.match(
      /<(?:p|span|div)[^>]*class=["'][^"']*(?:desc|summary|snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|div)>/i
    );
    const description = descMatch
      ? descMatch[1].replace(/<[^>]*>/g, "").trim().slice(0, 800)
      : "";

    // Extract location from the block
    const locMatch = block.match(
      /<(?:span|div|p)[^>]*class=["'][^"']*(?:venue|location|place)[^"']*["'][^>]*>([^<]+)<\//i
    );
    const location = locMatch ? locMatch[1].trim() : city;

    events.push({
      id: `10t-${hashString(title + date)}`,
      title,
      description,
      date,
      endDate,
      location: location.slice(0, 300),
      url,
      source: "luma",
      category: categorizeEvent(title, description),
    });
  }

  // Pattern 3: Fallback — scan for event links with nearby dates
  // This catches simpler listing formats
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = cardRegex.exec(html)) !== null) {
    const href = linkMatch[1];
    const linkText = linkMatch[2].replace(/<[^>]*>/g, "").trim();

    // Skip navigation links, short text, already-seen
    if (
      linkText.length < 5 ||
      linkText.length > 150 ||
      seenTitles.has(linkText.toLowerCase())
    )
      continue;

    // Skip non-event paths
    if (
      href.includes("/about") ||
      href.includes("/contact") ||
      href.includes("/login") ||
      href.includes("/register") ||
      href.includes("/search") ||
      href.includes("/privacy") ||
      href.includes("/terms")
    )
      continue;

    seenTitles.add(linkText.toLowerCase());

    // Look for a date near this link in the surrounding HTML
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
        // invalid date
      }
      dateRegex.lastIndex = 0;
    }

    events.push({
      id: `10t-${hashString(linkText + date)}`,
      title: linkText,
      description: "",
      date,
      location: city,
      url: `https://10times.com${href}`,
      source: "luma",
      category: categorizeEvent(linkText, ""),
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Fetch a single city page
// ---------------------------------------------------------------------------
async function fetchCityPage(
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
        batch.map(({ url, city }) => fetchCityPage(url, city))
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
      source: "10times",
      cities: CITY_SLUGS.length,
      categories: CATEGORIES.length,
    });
  } catch (error) {
    console.error("10times route error:", error);
    return NextResponse.json({ events: [], count: 0, source: "10times" });
  }
}
