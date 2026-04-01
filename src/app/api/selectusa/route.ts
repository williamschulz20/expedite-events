import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";

// ---------------------------------------------------------------------------
// SelectUSA Investment Summit scraper
//
// SelectUSA is a US Government initiative that promotes foreign direct
// investment. Their annual Investment Summit and regional roadshows attract
// exactly the ICP Expedite serves: international founders planning to expand
// or relocate to the US (O-1A visa candidates).
//
// Strategy:
//   1. Fetch the SelectUSA events page + summit page for JSON-LD / meta data
//   2. Search DuckDuckGo for "SelectUSA 2026" events
//   3. Hardcode known events (summit + regional roadshows)
//   4. Merge, dedup, and return as FounderEvent[]
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SELECTUSA_PAGES = [
  "https://www.selectusa.gov/events",
  "https://www.selectusa.gov/selectusa-summit",
];

const DDG_QUERIES = [
  "SelectUSA Investment Summit 2026",
  "SelectUSA 2026 event",
  "SelectUSA roadshow Europe 2026",
  "SelectUSA roadshow Asia 2026",
];

// Domains to skip in search results
const SKIP_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com",
  "youtube.com", "reddit.com", "wikipedia.org",
];

// ---------------------------------------------------------------------------
// Known / hardcoded events (updated manually as dates are announced)
// ---------------------------------------------------------------------------
const KNOWN_EVENTS: FounderEvent[] = [
  {
    id: "selectusa-summit-2026",
    title: "SelectUSA Investment Summit 2026",
    description:
      "The premier US government event connecting international businesses and economic development organizations with resources to facilitate business investment in the United States. High density of international founders, corporate executives, and government officials exploring US expansion. Perfect O-1A visa pipeline for Expedite.",
    date: "2026-06-21T09:00:00Z",
    endDate: "2026-06-25T17:00:00Z",
    location: "Gaylord National Resort & Convention Center, National Harbor, MD",
    url: "https://www.selectusa.gov/selectusa-summit",
    source: "selectusa",
    category: "networking",
    leadScore: 95,
    leadTier: "hot",
    highLeverage: true,
    leverageReason:
      "US Government investment summit — international founders actively planning US expansion + international / european founder angle",
  },
  {
    id: "selectusa-roadshow-europe-2026",
    title: "SelectUSA European Roadshow 2026",
    description:
      "SelectUSA roadshow across major European cities, connecting European founders and businesses with resources to invest and expand in the United States. Includes sessions in London, Paris, Berlin, and other hubs.",
    date: "",
    location: "Multiple European cities",
    url: "https://www.selectusa.gov/events",
    source: "selectusa",
    category: "networking",
    leadScore: 92,
    leadTier: "hot",
    highLeverage: true,
    leverageReason:
      "US expansion roadshow targeting European founders — direct O-1A pipeline + international / european founder angle",
  },
  {
    id: "selectusa-roadshow-asia-2026",
    title: "SelectUSA Asia Roadshow 2026",
    description:
      "SelectUSA roadshow across Asian markets, connecting founders and companies with US investment and expansion opportunities. Covers Japan, South Korea, India, and Southeast Asia.",
    date: "",
    location: "Multiple Asian cities",
    url: "https://www.selectusa.gov/events",
    source: "selectusa",
    category: "networking",
    leadScore: 88,
    leadTier: "hot",
    highLeverage: true,
    leverageReason:
      "US expansion roadshow for Asian founders — strong O-1A visa demand",
  },
  {
    id: "selectusa-roadshow-latam-2026",
    title: "SelectUSA Latin America Roadshow 2026",
    description:
      "SelectUSA roadshow across Latin American markets. Connects LatAm founders with US investment and business expansion resources.",
    date: "",
    location: "Multiple LatAm cities",
    url: "https://www.selectusa.gov/events",
    source: "selectusa",
    category: "networking",
    leadScore: 85,
    leadTier: "hot",
    highLeverage: true,
    leverageReason:
      "US expansion roadshow for LatAm founders — high O-1A demand",
  },
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
// Fetch a page and extract JSON-LD Event objects
// ---------------------------------------------------------------------------
async function extractJsonLdEvents(url: string): Promise<FounderEvent[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const events: FounderEvent[] = [];

    // Extract JSON-LD blocks
    const jsonLdMatches = [
      ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
    ];

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
                : item.location?.name ??
                  item.location?.address?.addressLocality ??
                  "United States";

            const title = (item.name as string).slice(0, 200);
            const description = ((item.description as string) ?? "").slice(0, 800);

            const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(
              title,
              description + " us expansion selectusa international founder"
            );

            events.push({
              id: `selectusa-${hashStr(url + item.name)}`,
              title,
              description,
              date: (item.startDate as string) ?? "",
              endDate: (item.endDate as string) ?? undefined,
              location: (loc as string).slice(0, 300),
              url,
              source: "selectusa",
              category: categorizeEvent(title, description),
              leadScore: Math.max(score, 80), // SelectUSA events are inherently high-value
              leadTier: tier === "cold" ? "warm" : tier,
              highLeverage: true,
              leverageReason:
                leverageReason || "SelectUSA event — international founders planning US expansion",
            });
          }
        }
      } catch {
        /* skip malformed JSON-LD */
      }
    }

    // Also try to extract Open Graph data if no JSON-LD events found
    if (events.length === 0) {
      const ogTitle =
        html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1];
      const ogDesc =
        html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1];
      const ogDate =
        html.match(/<meta[^>]*(?:name|property)="(?:event:start_time|article:published_time)"[^>]*content="([^"]+)"/i)?.[1];

      if (ogTitle && ogTitle.toLowerCase().includes("selectusa")) {
        events.push({
          id: `selectusa-${hashStr(url)}`,
          title: ogTitle.slice(0, 200),
          description: (ogDesc ?? "").slice(0, 800),
          date: ogDate ?? "",
          location: "United States",
          url,
          source: "selectusa",
          category: categorizeEvent(ogTitle, ogDesc ?? ""),
          leadScore: 85,
          leadTier: "hot",
          highLeverage: true,
          leverageReason: "SelectUSA event — international founders planning US expansion",
        });
      }
    }

    return events;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Search DuckDuckGo for SelectUSA events
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
          "Accept-Language": "en-US,en;q=0.9",
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
      if (results.length >= 6) break;
    }

    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() + 18); // look 18 months ahead for summits

  const events: FounderEvent[] = [];
  const seenIds = new Set<string>();

  // 1. Add hardcoded known events (always present)
  for (const ev of KNOWN_EVENTS) {
    if (ev.date) {
      const d = new Date(ev.date);
      if (d < now || d > cutoff) continue;
    }
    seenIds.add(ev.id);
    events.push(ev);
  }

  // 2. Fetch SelectUSA pages for JSON-LD data
  const pageResults = await Promise.allSettled(
    SELECTUSA_PAGES.map((url) => extractJsonLdEvents(url))
  );
  for (const r of pageResults) {
    if (r.status === "fulfilled") {
      for (const ev of r.value) {
        if (seenIds.has(ev.id)) continue;
        if (ev.date) {
          const d = new Date(ev.date);
          if (d < now || d > cutoff) continue;
        }
        seenIds.add(ev.id);
        events.push(ev);
      }
    }
  }

  // 3. Search DDG for additional SelectUSA events
  const allSearchResults: Array<{ url: string; title: string; snippet: string }> = [];
  for (let i = 0; i < DDG_QUERIES.length; i += 2) {
    const batch = DDG_QUERIES.slice(i, i + 2);
    const batchResults = await Promise.allSettled(
      batch.map((q) => searchDDG(q))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") allSearchResults.push(...r.value);
    }
    // Small delay between batches
    if (i + 2 < DDG_QUERIES.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Dedup search results by URL
  const seenUrls = new Set<string>();
  const uniqueSearchResults = allSearchResults.filter((r) => {
    if (seenUrls.has(r.url)) return false;
    seenUrls.add(r.url);
    return true;
  });

  // For search results that look relevant, try to scrape JSON-LD
  const relevantResults = uniqueSearchResults.filter((r) => {
    const text = `${r.title} ${r.snippet}`.toLowerCase();
    return (
      text.includes("selectusa") ||
      text.includes("select usa") ||
      text.includes("investment summit") ||
      text.includes("us expansion") ||
      text.includes("invest in america")
    );
  });

  const scrapeResults = await Promise.allSettled(
    relevantResults.slice(0, 8).map((r) => extractJsonLdEvents(r.url))
  );
  for (const r of scrapeResults) {
    if (r.status === "fulfilled") {
      for (const ev of r.value) {
        if (seenIds.has(ev.id)) continue;
        if (ev.date) {
          const d = new Date(ev.date);
          if (d < now || d > cutoff) continue;
        }
        seenIds.add(ev.id);
        events.push(ev);
      }
    }
  }

  // Add remaining search results as title-only events if they score well
  for (const r of relevantResults) {
    const id = `selectusa-${hashStr(r.url)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(
      r.title,
      r.snippet + " us expansion selectusa international founder"
    );
    if (score < 40) continue;

    events.push({
      id,
      title: r.title.slice(0, 200),
      description: r.snippet.slice(0, 400),
      date: "",
      location: "United States",
      url: r.url,
      source: "selectusa",
      category: categorizeEvent(r.title, r.snippet),
      leadScore: Math.max(score, 75),
      leadTier: tier === "cold" ? "warm" : tier,
      highLeverage: highLeverage || true,
      leverageReason:
        leverageReason || "SelectUSA-related event — international founders exploring US expansion",
    });
  }

  // Sort: dated events first (chronological), then undated
  events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return NextResponse.json({ events, count: events.length, source: "selectusa" });
}
