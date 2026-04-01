import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";

// ---------------------------------------------------------------------------
// Google Search scraper — finds startup/founder events across cities via
// Google HTML search results
//
// Strategy:
//   1. Build targeted queries: "{keyword} {city} {month} {year}"
//   2. Scrape Google HTML results for event page URLs + titles
//   3. For promising URLs (event domains), fetch the page and extract
//      date/location via JSON-LD or meta tags
//   4. Sample 3 random cities per keyword×month to stay within timeout
// ---------------------------------------------------------------------------

// Cities to search
const CITIES = [
  "London", "Berlin", "Paris", "Amsterdam", "San Francisco",
  "Munich", "Barcelona", "Stockholm", "Helsinki", "Lisbon",
  "Dublin", "Copenhagen", "Zurich", "Vienna", "Warsaw",
  "Tallinn", "Riga", "Vilnius", "Oslo", "Bucharest",
  "Sofia", "Krakow", "Prague", "Budapest", "Milan",
  "Madrid", "Brussels", "Hamburg", "Geneva", "Istanbul",
  "New York", "Austin", "Boston",
];

// Keywords matching category tabs
const KEYWORDS = [
  "hackathon",
  "demo day startup",
  "pitch night founder",
  "networking event tech",
  "fundraising VC investor",
  "accelerator program",
  "founder dinner",
  "founder breakfast",
  "tech workshop",
  "startup conference",
  "tech meetup",
];

// Domains to skip
const SKIP_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com",
  "youtube.com", "reddit.com", "wikipedia.org", "glassdoor",
  "indeed.com", "crunchbase.com", "pinterest.com", "tiktok.com",
];

// Event-signal domains (prioritize these)
const EVENT_DOMAINS = [
  "eventbrite", "lu.ma", "luma", "meetup.com", "partiful",
  "universe.com", "tickettailor", "hopin", "conference",
  "summit", "festival", "f6s.com", "confs.tech",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Generate upcoming month strings: "April 2026", "May 2026", ...
// ---------------------------------------------------------------------------
function getUpcomingMonths(count: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
    months.push(label);
  }
  return months;
}

// ---------------------------------------------------------------------------
// Pick N random items from an array (Fisher-Yates sample)
// ---------------------------------------------------------------------------
function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const idx = Math.floor(Math.random() * (copy.length - i)) + i;
    [copy[i], copy[idx]] = [copy[idx], copy[i]];
    result.push(copy[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Random delay between min and max ms
// ---------------------------------------------------------------------------
function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Simple URL hash (same as websearch scraper)
// ---------------------------------------------------------------------------
function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) - h) + url.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ---------------------------------------------------------------------------
// Search Google HTML for a query, return result URLs + titles
// ---------------------------------------------------------------------------
async function searchGoogle(
  query: string
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  try {
    const res = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return [];

    const html = await res.text();
    const results: Array<{ url: string; title: string; snippet: string }> = [];

    // Google wraps result links in <a href="/url?q=ACTUAL_URL&...">
    const linkPattern = /<a[^>]*href="\/url\?q=([^&"]+)&[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    let m: RegExpExecArray | null;
    while ((m = linkPattern.exec(html)) !== null) {
      const rawUrl = decodeURIComponent(m[1]);
      const rawTitle = m[2].replace(/<[^>]+>/g, "").trim(); // strip inner HTML tags

      // Skip internal Google links, ads, and low-signal domains
      if (!rawUrl.startsWith("http")) continue;
      if (rawUrl.includes("google.com")) continue;
      if (SKIP_DOMAINS.some((d) => rawUrl.includes(d))) continue;
      if (!rawTitle) continue;

      results.push({ url: rawUrl, title: rawTitle, snippet: "" });
      if (results.length >= 8) break;
    }

    // Try to extract snippets from the page — Google uses <span> blocks near results
    // This is best-effort; snippets may not always match 1:1 with links
    const snippetPattern = /<span[^>]*class="[^"]*(?:st|aCOpRe)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    let sIdx = 0;
    let sm: RegExpExecArray | null;
    while ((sm = snippetPattern.exec(html)) !== null && sIdx < results.length) {
      const text = sm[1].replace(/<[^>]+>/g, "").trim();
      if (text.length > 20) {
        results[sIdx].snippet = text.slice(0, 400);
        sIdx++;
      }
    }

    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Try to extract event details from a URL via JSON-LD or meta tags
// ---------------------------------------------------------------------------
async function scrapeEventPage(
  url: string,
  fallbackTitle: string,
  fallbackLocation: string
): Promise<FounderEvent | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try JSON-LD
    const jsonLdMatches = [
      ...html.matchAll(
        /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
      ),
    ];
    for (const match of jsonLdMatches) {
      try {
        const ld = JSON.parse(match[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if (item["@type"] === "Event" && item.startDate && item.name) {
            const loc =
              typeof item.location === "string"
                ? item.location
                : item.location?.name ??
                  item.location?.address?.addressLocality ??
                  fallbackLocation;

            return {
              id: `gsearch-${hashUrl(url)}`,
              title: (item.name as string).slice(0, 200),
              description: ((item.description as string) ?? "").slice(0, 800),
              date: item.startDate as string,
              endDate: (item.endDate as string) ?? undefined,
              location: (loc as string).slice(0, 300),
              url,
              source: "luma",
              category: categorizeEvent(
                item.name as string,
                (item.description as string) ?? ""
              ),
            };
          }
        }
      } catch {
        /* skip malformed JSON-LD */
      }
    }

    // Try Open Graph / meta fallback
    const ogTitle = html.match(
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i
    )?.[1];
    const ogDate = html.match(
      /<meta[^>]*(?:name|property)="(?:event:start_time|article:published_time)"[^>]*content="([^"]+)"/i
    )?.[1];

    if (ogTitle && ogDate) {
      return {
        id: `gsearch-${hashUrl(url)}`,
        title: ogTitle.slice(0, 200),
        description: "",
        date: ogDate,
        location: fallbackLocation,
        url,
        source: "luma",
        category: categorizeEvent(ogTitle, ""),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() + 12);

  const months = getUpcomingMonths(6);

  // Build search queries: for each keyword × month, pick 3 random cities
  // This limits total queries to ~11 keywords × 6 months × 3 cities = ~198
  const queries: Array<{ query: string; city: string }> = [];
  for (const kw of KEYWORDS) {
    for (const month of months) {
      const selectedCities = sample(CITIES, 3);
      for (const city of selectedCities) {
        queries.push({
          query: `${kw} ${city} ${month}`,
          city,
        });
      }
    }
  }

  // Run searches in parallel batches of 4 (Google is stricter than DDG)
  const allResults: Array<{
    url: string;
    title: string;
    snippet: string;
    city: string;
  }> = [];

  for (let i = 0; i < queries.length; i += 4) {
    const batch = queries.slice(i, i + 4);
    const batchResults = await Promise.allSettled(
      batch.map(async ({ query, city }) => {
        const results = await searchGoogle(query);
        return results.map((r) => ({ ...r, city }));
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") allResults.push(...r.value);
    }

    // Random delay between batches to avoid blocks
    if (i + 4 < queries.length) {
      await delay(500, 1500);
    }
  }

  // Dedup by URL
  const seenUrls = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seenUrls.has(r.url)) return false;
    seenUrls.add(r.url);
    return true;
  });

  // Prioritise results from known event domains — scrape those pages for structured data
  const prioritised = uniqueResults.sort((a, b) => {
    const aIsEvent = EVENT_DOMAINS.some((d) => a.url.includes(d)) ? 0 : 1;
    const bIsEvent = EVENT_DOMAINS.some((d) => b.url.includes(d)) ? 0 : 1;
    return aIsEvent - bIsEvent;
  });

  // Scrape up to 25 event-domain pages for structured data (in batches of 4)
  const toScrape = prioritised
    .filter((r) => EVENT_DOMAINS.some((d) => r.url.includes(d)))
    .slice(0, 25);

  const scrapedEvents: FounderEvent[] = [];
  for (let i = 0; i < toScrape.length; i += 4) {
    const batch = toScrape.slice(i, i + 4);
    const batchResults = await Promise.allSettled(
      batch.map((r) => scrapeEventPage(r.url, r.title, r.city))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value) {
        scrapedEvents.push(r.value);
      }
    }
    if (i + 4 < toScrape.length) {
      await delay(300, 800);
    }
  }

  const events: FounderEvent[] = [];
  const seenIds = new Set<string>();

  // Add scraped structured events (with date filtering)
  for (const ev of scrapedEvents) {
    if (seenIds.has(ev.id)) continue;
    if (!ev.date) continue;
    const d = new Date(ev.date);
    if (d < now || d > cutoff) continue;
    seenIds.add(ev.id);

    const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(
      ev.title,
      ev.description
    );
    events.push({
      ...ev,
      leadScore: score,
      leadTier: tier,
      highLeverage,
      leverageReason,
    });
  }

  // For results without scraped data, add as title-only events
  for (const r of uniqueResults.slice(0, 40)) {
    const id = `gsearch-${hashUrl(r.url)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(
      r.title,
      r.snippet
    );
    if (score < 30) continue; // skip very low signal results

    events.push({
      id,
      title: r.title.slice(0, 200),
      description: r.snippet.slice(0, 400),
      date: "", // unknown — shows at bottom of list
      location: r.city,
      url: r.url,
      source: "luma",
      category: categorizeEvent(r.title, r.snippet),
      leadScore: score,
      leadTier: tier,
      highLeverage,
      leverageReason,
    });
  }

  return NextResponse.json({
    events,
    count: events.length,
    source: "googlesearch",
  });
}
