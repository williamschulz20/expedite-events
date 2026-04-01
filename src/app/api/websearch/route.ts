import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";

// ---------------------------------------------------------------------------
// Web search scraper — finds startup events across European cities via
// DuckDuckGo HTML search (no API key, no rate-limit blocks)
//
// Strategy:
//   1. Build targeted queries: "{keyword} {city} 2026"
//   2. Scrape DuckDuckGo HTML results for event page URLs + titles
//   3. For promising URLs, fetch the page and try to extract date/location
//      via JSON-LD or meta tags
// ---------------------------------------------------------------------------

// Cities NOT well covered by Luma — primary targets
const UNCOVERED_CITIES = [
  "Tallinn", "Riga", "Vilnius",           // Baltics — high Expedite relevance
  "Edinburgh", "Manchester",              // UK non-London
  "Lyon", "Marseille",                    // France non-Paris
  "Krakow", "Wroclaw",                    // Poland non-Warsaw
  "Bucharest", "Athens", "Sofia",         // South-East Europe
  "Rotterdam", "Eindhoven",              // Netherlands non-Amsterdam
  "Gothenburg", "Malmö",                  // Sweden non-Stockholm
];

// High-signal keywords that match O-1A-relevant events
const EVENT_KEYWORDS = [
  "startup", "founder", "hackathon",
  "pitch night", "demo day", "accelerator",
  "venture capital", "tech meetup",
];

// Domains that are actual event pages (not news articles / aggregators)
const EVENT_DOMAINS = [
  "eventbrite", "lu.ma", "partiful", "meetup.com",
  "luma", "universe.com", "tickettailor", "hopin",
  "conference", "summit", "festival", "forum",
];

// Domains to skip (low signal)
const SKIP_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com",
  "youtube.com", "reddit.com", "wikipedia.org", "glassdoor",
  "indeed.com", "crunchbase.com", "techcrunch.com", "forbes.com",
];

// ---------------------------------------------------------------------------
// Search DuckDuckGo for a query, return result URLs + titles
// ---------------------------------------------------------------------------
async function searchDDG(query: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) return [];

    const html = await res.text();
    const results: Array<{ url: string; title: string; snippet: string }> = [];

    // DuckDuckGo HTML results: <a class="result__a" href="...">Title</a>
    // and <a class="result__snippet">...snippet...</a>
    const resultPattern = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
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

      // Skip ads, trackers, low-signal domains
      if (url.startsWith("/") || url.includes("duckduckgo.com")) continue;
      if (SKIP_DOMAINS.some((d) => url.includes(d))) { idx++; continue; }

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
// Try to extract event details from a URL via JSON-LD or meta tags
// ---------------------------------------------------------------------------
async function scrapeEventPage(url: string, fallbackTitle: string, fallbackLocation: string): Promise<FounderEvent | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try JSON-LD
    const jsonLdMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of jsonLdMatches) {
      try {
        const ld = JSON.parse(match[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if (item["@type"] === "Event" && item.startDate && item.name) {
            const loc =
              typeof item.location === "string" ? item.location :
              item.location?.name ?? item.location?.address?.addressLocality ?? fallbackLocation;

            return {
              id: `web-${hashUrl(url)}`,
              title: (item.name as string).slice(0, 200),
              description: ((item.description as string) ?? "").slice(0, 800),
              date: item.startDate as string,
              endDate: (item.endDate as string) ?? undefined,
              location: (loc as string).slice(0, 300),
              url,
              source: "luma", // no dedicated "web" source — treated as general
              category: categorizeEvent(item.name as string, (item.description as string) ?? ""),
            };
          }
        }
      } catch { /* skip */ }
    }

    // Try Open Graph / meta fallback
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1];
    const ogDate  = html.match(/<meta[^>]*(?:name|property)="(?:event:start_time|article:published_time)"[^>]*content="([^"]+)"/i)?.[1];

    if (ogTitle && ogDate) {
      return {
        id: `web-${hashUrl(url)}`,
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

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) - h) + url.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() + 12);

  // Build search queries: 2-3 keywords per city to avoid too many requests
  const queries: Array<{ query: string; city: string }> = [];
  for (const city of UNCOVERED_CITIES) {
    // Pick top 3 keywords per city
    for (const kw of EVENT_KEYWORDS.slice(0, 3)) {
      queries.push({ query: `${kw} event ${city} 2026`, city });
    }
  }

  // Run searches in parallel batches of 8
  const allResults: Array<{ url: string; title: string; snippet: string; city: string }> = [];
  for (let i = 0; i < queries.length; i += 8) {
    const batch = queries.slice(i, i + 8);
    const batchResults = await Promise.allSettled(
      batch.map(async ({ query, city }) => {
        const results = await searchDDG(query);
        return results.map((r) => ({ ...r, city }));
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") allResults.push(...r.value);
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

  // Scrape up to 20 event pages for structured data
  const toScrape = prioritised.slice(0, 20);
  const scrapeResults = await Promise.allSettled(
    toScrape.map((r) => scrapeEventPage(r.url, r.title, r.city))
  );

  const events: FounderEvent[] = [];
  const seenIds = new Set<string>();

  // Add scraped structured events
  for (const r of scrapeResults) {
    if (r.status === "fulfilled" && r.value) {
      const ev = r.value;
      if (seenIds.has(ev.id)) continue;
      if (!ev.date) continue;
      const d = new Date(ev.date);
      if (d < now || d > cutoff) continue;
      seenIds.add(ev.id);
      events.push(ev);
    }
  }

  // For results without scraped data, add as title-only events (no date filter)
  // — these show up in keyword searches but without confirmed dates
  for (const r of uniqueResults.slice(0, 30)) {
    const id = `web-${hashUrl(r.url)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(r.title, r.snippet);
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

  return NextResponse.json({ events, count: events.length, source: "websearch" });
}
