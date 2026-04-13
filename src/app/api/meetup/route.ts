import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Meetup.com scraper — multi-city, multi-keyword
// Uses HTML scraping of search results + JSON-LD extraction
// ---------------------------------------------------------------------------

const SEARCH_QUERIES = [
  "startup founders",
  "founder networking",
  "tech startup",
  "entrepreneur meetup",
  "demo day",
  "pitch night",
  "hackathon",
  "venture capital",
  "AI founders",
  "SaaS founders",
  "fintech meetup",
  "founder dinner",
  "CTO meetup",
];

const CITIES = [
  "London", "Berlin", "Paris", "Amsterdam", "San Francisco",
  "New York", "Munich", "Barcelona", "Stockholm", "Helsinki",
  "Dublin", "Lisbon", "Copenhagen", "Tallinn", "Riga",
  "Vienna", "Zurich", "Oslo", "Los Angeles", "Austin",
];

// ---------------------------------------------------------------------------
// Scrape Meetup search results page for event data
// ---------------------------------------------------------------------------
async function searchMeetupCity(
  query: string,
  city: string
): Promise<FounderEvent[]> {
  const events: FounderEvent[] = [];

  try {
    const url = `https://www.meetup.com/find/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(city)}&source=EVENTS&eventType=upcoming`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return events;
    const html = await res.text();

    // Strategy 1: JSON-LD structured data
    const jsonLdBlocks = [...html.matchAll(
      /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )];

    for (const match of jsonLdBlocks) {
      try {
        const ld = JSON.parse(match[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if (item["@type"] === "Event" && item.name && item.startDate) {
            const loc = typeof item.location === "string"
              ? item.location
              : item.location?.name || item.location?.address?.addressLocality || city;

            events.push({
              id: `meetup-${hashString(item.url || item.name)}`,
              title: item.name,
              description: ((item.description as string) || "").replace(/<[^>]*>/g, "").slice(0, 500),
              date: item.startDate,
              endDate: item.endDate || undefined,
              location: loc,
              url: item.url || "",
              source: "meetup",
              category: categorizeEvent(item.name, (item.description as string) || ""),
              imageUrl: typeof item.image === "string" ? item.image : item.image?.url || undefined,
            });
          }
          if (item["@type"] === "ItemList" && Array.isArray(item.itemListElement)) {
            for (const li of item.itemListElement) {
              const evt = li.item || li;
              if ((evt["@type"] === "Event" || evt["@type"] === "SocialEvent") && evt.name) {
                events.push({
                  id: `meetup-${hashString(evt.url || evt.name)}`,
                  title: evt.name,
                  description: ((evt.description as string) || "").replace(/<[^>]*>/g, "").slice(0, 500),
                  date: evt.startDate || "",
                  endDate: evt.endDate || undefined,
                  location: typeof evt.location === "string" ? evt.location : evt.location?.name || city,
                  url: evt.url || "",
                  source: "meetup",
                  category: categorizeEvent(evt.name, (evt.description as string) || ""),
                });
              }
            }
          }
        }
      } catch { /* skip */ }
    }

    // Strategy 2: Extract event links from the page HTML
    const seenUrls = new Set(events.map(e => e.url));
    const linkPattern = /href="(https:\/\/www\.meetup\.com\/[^"]*\/events\/[^"?]+)/gi;

    let linkMatch;
    while ((linkMatch = linkPattern.exec(html)) !== null) {
      const evtUrl = linkMatch[1];
      if (seenUrls.has(evtUrl)) continue;
      seenUrls.add(evtUrl);

      const urlParts = evtUrl.match(/meetup\.com\/([^/]+)\/events\/(\d+)/);
      if (!urlParts) continue;

      const groupSlug = urlParts[1];
      const title = groupSlug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      events.push({
        id: `meetup-${urlParts[2]}`,
        title,
        description: "",
        date: "",
        location: city,
        url: evtUrl,
        source: "meetup",
        category: categorizeEvent(title, query),
      });
    }

    // Strategy 3: Apollo state / __NEXT_DATA__
    const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const nd = JSON.parse(nextDataMatch[1]);
        const results = nd?.props?.pageProps?.searchResults?.edges ||
                       nd?.props?.pageProps?.results ||
                       [];
        for (const edge of results) {
          const evt = edge?.node || edge;
          if (evt?.title && evt?.dateTime) {
            const id = `meetup-${evt.id || hashString(evt.title)}`;
            if (events.some(e => e.id === id)) continue;
            events.push({
              id,
              title: evt.title,
              description: (evt.description || "").replace(/<[^>]*>/g, "").slice(0, 500),
              date: evt.dateTime,
              endDate: evt.endTime || undefined,
              location: evt.venue?.name || city,
              url: evt.eventUrl || `https://www.meetup.com/events/${evt.id}/`,
              source: "meetup",
              category: categorizeEvent(evt.title, evt.description || ""),
              imageUrl: evt.imageUrl || undefined,
            });
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* query failed */ }

  return events;
}

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const allEvents: FounderEvent[] = [];

    // Top 4 queries per city — batched to avoid hammering
    const topQueries = SEARCH_QUERIES.slice(0, 4);

    for (const city of CITIES) {
      const tasks = topQueries.map(q => searchMeetupCity(q, city));
      const results = await Promise.allSettled(tasks);
      for (const r of results) {
        if (r.status === "fulfilled") allEvents.push(...r.value);
      }
    }

    // Dedup
    const seen = new Set<string>();
    const unique = allEvents.filter(e => {
      const key = e.url || e.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter: future events, next 18 months
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() + 18);

    const filtered = unique.filter(e => {
      if (!e.date) return true;
      const d = new Date(e.date);
      if (isNaN(d.getTime())) return true;
      return d >= now && d <= cutoff;
    });

    filtered.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

    return NextResponse.json({
      events: filtered,
      count: filtered.length,
      source: "meetup",
      cities: CITIES.length,
    });
  } catch (error) {
    console.error("Meetup scraper error:", error);
    return NextResponse.json({ events: [], count: 0, source: "meetup" });
  }
}
