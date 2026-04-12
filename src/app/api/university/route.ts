import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";

// ---------------------------------------------------------------------------
// University startup / tech event scraper
//
// University hackathons, demo days, and entrepreneur events attract early-stage
// founders — Expedite's core ICP. Many are international students on visas
// who will need O-1A support post-graduation.
//
// Strategy:
//   1. For each target university, run 2-3 DDG searches
//   2. Filter results for event-like pages
//   3. For promising URLs, fetch and extract JSON-LD or meta data
//   4. Batch 4 concurrent with delays to avoid rate limiting
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Target universities — top startup ecosystems
// ---------------------------------------------------------------------------
interface UniversityDef {
  name: string;
  shortName: string;
  location: string;
}

const UNIVERSITIES: UniversityDef[] = [
  // UK
  { name: "Imperial College London", shortName: "Imperial", location: "London, UK" },
  { name: "UCL", shortName: "UCL", location: "London, UK" },
  { name: "LSE", shortName: "LSE", location: "London, UK" },
  { name: "London Business School", shortName: "LBS", location: "London, UK" },
  { name: "Oxford University", shortName: "Oxford", location: "Oxford, UK" },
  { name: "Cambridge University", shortName: "Cambridge", location: "Cambridge, UK" },
  { name: "Said Business School Oxford", shortName: "Said", location: "Oxford, UK" },
  { name: "Judge Business School Cambridge", shortName: "Judge", location: "Cambridge, UK" },
  // US
  { name: "MIT", shortName: "MIT", location: "Cambridge, MA, USA" },
  { name: "Stanford University", shortName: "Stanford", location: "Stanford, CA, USA" },
  // Europe
  { name: "ETH Zurich", shortName: "ETH", location: "Zurich, Switzerland" },
  { name: "TU Berlin", shortName: "TU Berlin", location: "Berlin, Germany" },
  { name: "HEC Paris", shortName: "HEC", location: "Paris, France" },
  { name: "INSEAD", shortName: "INSEAD", location: "Fontainebleau, France" },
];

// Search query templates — {uni} is replaced with university name
const QUERY_TEMPLATES = [
  "{uni} startup event 2026",
  "{uni} hackathon 2026",
  "{uni} entrepreneur event 2026",
];

// Domains to skip
const SKIP_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com",
  "youtube.com", "reddit.com", "wikipedia.org", "glassdoor.com",
  "indeed.com", "quora.com",
];

// Event-signal domains (prioritised for scraping)
const EVENT_DOMAINS = [
  "eventbrite", "lu.ma", "luma", "partiful", "meetup.com",
  "universe.com", "tickettailor", "hopin", "bevy.com",
];

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ---------------------------------------------------------------------------
// Search DuckDuckGo
// ---------------------------------------------------------------------------
async function searchDDG(
  query: string
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) return [];

    const html = await res.text();
    const results: Array<{ url: string; title: string; snippet: string }> = [];

    const resultPattern =
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetPattern = /class="result__snippet"[^>]*>([^<]+)/gi;

    const snippets: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = snippetPattern.exec(html)) !== null) {
      snippets.push(sm[1].trim());
    }

    let idx = 0;
    let m: RegExpExecArray | null;
    while ((m = resultPattern.exec(html)) !== null) {
      const url = m[1];
      const title = m[2].trim();

      if (url.startsWith("/") || url.includes("duckduckgo.com")) continue;
      if (SKIP_DOMAINS.some((d) => url.includes(d))) {
        idx++;
        continue;
      }

      results.push({ url, title, snippet: snippets[idx] ?? "" });
      idx++;
      if (results.length >= 5) break;
    }

    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scrape a page for JSON-LD Event data or OG meta
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
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try JSON-LD
    const jsonLdMatches = [
      ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
    ];
    for (const match of jsonLdMatches) {
      try {
        const ld = JSON.parse(match[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if (
            (item["@type"] === "Event" || item["@type"] === "BusinessEvent" || item["@type"] === "SocialEvent") &&
            item.name
          ) {
            const loc =
              typeof item.location === "string"
                ? item.location
                : item.location?.name ??
                  item.location?.address?.addressLocality ??
                  fallbackLocation;

            return {
              id: `uni-${hashStr(url)}`,
              title: (item.name as string).slice(0, 200),
              description: ((item.description as string) ?? "").slice(0, 800),
              date: (item.startDate as string) ?? "",
              endDate: (item.endDate as string) ?? undefined,
              location: (loc as string).slice(0, 300),
              url,
              source: "university",
              category: categorizeEvent(item.name as string, (item.description as string) ?? ""),
            };
          }
        }
      } catch {
        /* skip */
      }
    }

    // Try Open Graph meta fallback
    const ogTitle =
      html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1];
    const ogDesc =
      html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1];
    const ogDate =
      html.match(/<meta[^>]*(?:name|property)="(?:event:start_time|article:published_time)"[^>]*content="([^"]+)"/i)?.[1];

    if (ogTitle && ogDate) {
      return {
        id: `uni-${hashStr(url)}`,
        title: ogTitle.slice(0, 200),
        description: (ogDesc ?? "").slice(0, 800),
        date: ogDate,
        location: fallbackLocation,
        url,
        source: "university",
        category: categorizeEvent(ogTitle, ogDesc ?? ""),
      };
    }

    // If we have at least an OG title that looks event-like, include without date
    if (ogTitle) {
      const eventSignals = [
        "hackathon", "startup", "founder", "entrepreneur", "pitch",
        "demo day", "summit", "conference", "workshop", "bootcamp",
        "competition", "challenge", "showcase", "networking",
      ];
      const titleLower = ogTitle.toLowerCase();
      if (eventSignals.some((s) => titleLower.includes(s))) {
        return {
          id: `uni-${hashStr(url)}`,
          title: ogTitle.slice(0, 200),
          description: (ogDesc ?? "").slice(0, 800),
          date: "",
          location: fallbackLocation,
          url,
          source: "university",
          category: categorizeEvent(ogTitle, ogDesc ?? ""),
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Process one university — search + scrape
// ---------------------------------------------------------------------------
async function processUniversity(
  uni: UniversityDef
): Promise<FounderEvent[]> {
  const queries = QUERY_TEMPLATES.map((t) => t.replace("{uni}", uni.name));

  // Run all queries for this university
  const searchResults: Array<{ url: string; title: string; snippet: string }> = [];
  for (const query of queries) {
    const results = await searchDDG(query);
    searchResults.push(...results);
    // Small delay between queries for the same university
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // Dedup by URL
  const seenUrls = new Set<string>();
  const unique = searchResults.filter((r) => {
    if (seenUrls.has(r.url)) return false;
    seenUrls.add(r.url);
    return true;
  });

  // Prioritise event-domain URLs for scraping
  const sorted = unique.sort((a, b) => {
    const aIsEvent = EVENT_DOMAINS.some((d) => a.url.includes(d)) ? 0 : 1;
    const bIsEvent = EVENT_DOMAINS.some((d) => b.url.includes(d)) ? 0 : 1;
    return aIsEvent - bIsEvent;
  });

  // Scrape top 5 URLs for structured data
  const toScrape = sorted.slice(0, 5);
  const scrapeResults = await Promise.allSettled(
    toScrape.map((r) => scrapeEventPage(r.url, r.title, uni.location))
  );

  const events: FounderEvent[] = [];
  const scrapedUrls = new Set<string>();

  for (const r of scrapeResults) {
    if (r.status === "fulfilled" && r.value) {
      events.push(r.value);
      scrapedUrls.add(r.value.url);
    }
  }

  // For remaining results that weren't scraped successfully, add as title-only
  // if they score well enough
  for (const r of unique.slice(0, 10)) {
    if (scrapedUrls.has(r.url)) continue;
    const id = `uni-${hashStr(r.url)}`;

    const combinedText = `${r.title} ${r.snippet}`;
    const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(
      r.title,
      r.snippet + ` ${uni.name} university startup founder`
    );
    if (score < 25) continue;

    // Extra relevance check: must mention university or event-like keywords
    const textLower = combinedText.toLowerCase();
    const uniMentioned =
      textLower.includes(uni.shortName.toLowerCase()) ||
      textLower.includes(uni.name.toLowerCase());
    const eventLikeSignals = [
      "event", "hackathon", "startup", "founder", "entrepreneur",
      "pitch", "demo", "summit", "conference", "workshop", "competition",
      "challenge", "showcase", "networking", "meetup", "bootcamp",
    ];
    const hasEventSignal = eventLikeSignals.some((s) => textLower.includes(s));

    if (!uniMentioned && !hasEventSignal) continue;

    events.push({
      id,
      title: r.title.slice(0, 200),
      description: r.snippet.slice(0, 400),
      date: "",
      location: uni.location,
      url: r.url,
      source: "university",
      category: categorizeEvent(r.title, r.snippet),
      leadScore: score,
      leadTier: tier,
      highLeverage,
      leverageReason,
      organizerName: uni.name,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() + 12);

  const allEvents: FounderEvent[] = [];
  const seenIds = new Set<string>();

  // Process universities in batches of 4
  for (let i = 0; i < UNIVERSITIES.length; i += 4) {
    const batch = UNIVERSITIES.slice(i, i + 4);
    const batchResults = await Promise.allSettled(
      batch.map((uni) => processUniversity(uni))
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        for (const ev of r.value) {
          if (seenIds.has(ev.id)) continue;

          // Date filter (if date is available)
          if (ev.date) {
            const d = new Date(ev.date);
            if (d < now || d > cutoff) continue;
          }

          seenIds.add(ev.id);
          allEvents.push(ev);
        }
      }
    }

    // Delay between university batches to be polite to DDG
    if (i + 4 < UNIVERSITIES.length) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  // Sort: dated events first (chronological), then undated
  allEvents.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return NextResponse.json({
    events: allEvents,
    count: allEvents.length,
    source: "university",
  });
}
