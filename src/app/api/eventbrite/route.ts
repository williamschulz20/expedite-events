import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

const SEARCH_QUERIES = [
  "hackathon",
  "startup",
  "founder",
  "demo day",
  "pitch night",
  "networking tech",
  "investor",
  "accelerator",
  "entrepreneur",
  "AI meetup",
  "fintech",
  "SaaS",
  "venture capital",
  "seed funding",
  "startup launch",
  "tech networking",
];

// Eventbrite has a search API that returns JSON when you hit their internal endpoint
async function searchEventbrite(query: string): Promise<FounderEvent[]> {
  const events: FounderEvent[] = [];

  try {
    // Use Eventbrite's search page API which returns embedded JSON data
    const searchUrl = `https://www.eventbrite.co.uk/d/united-kingdom--london/${encodeURIComponent(query)}/?page=1&lang=en-gb`;

    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return events;
    const html = await res.text();

    // Strategy 1: Extract from window.__SERVER_DATA__ or similar embedded JSON
    const serverDataMatch = html.match(
      /window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/
    );
    if (serverDataMatch) {
      try {
        const serverData = JSON.parse(serverDataMatch[1]);
        const searchEvents =
          serverData?.search_data?.events?.results ||
          serverData?.jsonld?.events ||
          [];
        for (const evt of searchEvents) {
          events.push(mapEventbriteEvent(evt));
        }
      } catch {
        // parse failed
      }
    }

    // Strategy 2: JSON-LD structured data
    const jsonLdBlocks = [...html.matchAll(
      /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )];
    for (const match of jsonLdBlocks) {
      try {
        const ld = JSON.parse(match[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if (item["@type"] === "ItemList" && Array.isArray(item.itemListElement)) {
            for (const li of item.itemListElement) {
              const evt = li.item || li;
              if (evt["@type"] === "Event" || evt["@type"] === "SocialEvent") {
                events.push({
                  id: `eb-${hashString(evt.url || evt.name || "")}`,
                  title: evt.name || "",
                  description: (evt.description || "").slice(0, 500),
                  date: evt.startDate || "",
                  endDate: evt.endDate || undefined,
                  location:
                    evt.location?.name ||
                    evt.location?.address?.streetAddress ||
                    evt.location?.address?.addressLocality ||
                    "London",
                  url: evt.url || "",
                  source: "eventbrite",
                  category: categorizeEvent(evt.name || "", evt.description || ""),
                  imageUrl: typeof evt.image === "string" ? evt.image : evt.image?.url || undefined,
                });
              }
            }
          }
          if (item["@type"] === "Event" || item["@type"] === "SocialEvent") {
            const e = item;
            events.push({
              id: `eb-${hashString(e.url || e.name || "")}`,
              title: e.name || "",
              description: (e.description || "").slice(0, 500),
              date: e.startDate || "",
              endDate: e.endDate || undefined,
              location:
                e.location?.name ||
                e.location?.address?.addressLocality ||
                "London",
              url: e.url || "",
              source: "eventbrite",
              category: categorizeEvent(e.name || "", e.description || ""),
              imageUrl: typeof e.image === "string" ? e.image : e.image?.url || undefined,
            });
          }
        }
      } catch {
        // skip
      }
    }

    // Strategy 3: Extract event URLs and titles from links
    const linkPattern = /href="(https:\/\/www\.eventbrite\.co\.uk\/e\/([^"?]+)[^"]*)"/gi;
    const seenUrls = new Set(events.map((e) => e.url));
    let linkMatch;
    while ((linkMatch = linkPattern.exec(html)) !== null) {
      const url = linkMatch[1];
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const slug = linkMatch[2] || "";
      const title = slug
        .replace(/-tickets-\d+.*$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();

      if (!title || title.length < 5) continue;

      events.push({
        id: `eb-${hashString(url)}`,
        title,
        description: "",
        date: "",
        location: "London",
        url,
        source: "eventbrite",
        category: categorizeEvent(title, query),
      });
    }
  } catch {
    // query failed
  }

  return events;
}

function mapEventbriteEvent(evt: Record<string, unknown>): FounderEvent {
  const title = (evt.name as string) || (evt.title as string) || "";
  const description = (evt.description as string) || (evt.summary as string) || "";
  const url = (evt.url as string) || "";
  const startDate = (evt.start_date as string) || (evt.start as string) || "";
  const venue = evt.venue as Record<string, unknown> | undefined;
  const location = venue
    ? (venue.name as string) || (venue.address as string) || "London"
    : "London";
  const image = (evt.image_url as string) || (evt.logo_url as string) || "";

  return {
    id: `eb-${hashString(url || title)}`,
    title,
    description: description.slice(0, 500),
    date: startDate,
    endDate: (evt.end_date as string) || undefined,
    location,
    url,
    source: "eventbrite",
    category: categorizeEvent(title, description),
    imageUrl: image || undefined,
  };
}

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function dedup(events: FounderEvent[]): FounderEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = e.url || e.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET() {
  try {
    // Run all searches in parallel
    const results = await Promise.allSettled(
      SEARCH_QUERIES.map((q) => searchEventbrite(q))
    );

    const allEvents: FounderEvent[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") allEvents.push(...r.value);
    }

    // Don't filter by isRelevantEvent — the search queries already target relevant events
    const unique = dedup(allEvents).filter((e) => e.title.length > 3);

    unique.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.title.localeCompare(b.title);
    });

    return NextResponse.json({
      events: unique,
      count: unique.length,
      source: "eventbrite",
    });
  } catch (error) {
    console.error("Eventbrite error:", error);
    return NextResponse.json({ events: [], count: 0, source: "eventbrite" });
  }
}
