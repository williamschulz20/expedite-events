import { NextResponse } from "next/server";
import {
  FounderEvent,
  isRelevantEvent,
  categorizeEvent,
} from "@/lib/types";

const SEARCH_QUERIES = [
  "hackathon",
  "demo day founders",
  "startup pitch",
  "founder networking",
  "startup meetup",
  "tech founder",
  "investor networking",
  "accelerator showcase",
];

const BASE_URL = "https://www.eventbrite.co.uk/d/united-kingdom--london/";

/**
 * Extract events from Eventbrite search HTML using regex.
 * Eventbrite embeds structured data (JSON-LD) and also has predictable
 * markup patterns we can match against.
 */
function parseEventsFromHTML(html: string, query: string): FounderEvent[] {
  const events: FounderEvent[] = [];

  // Strategy 1: Extract JSON-LD structured data (most reliable)
  const jsonLdRegex =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;

  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (item["@type"] === "Event" || item["@type"] === "SocialEvent") {
          const title = item.name || "";
          const description = item.description || "";

          if (!isRelevantEvent(title, description)) continue;

          const event: FounderEvent = {
            id: `eb-${Buffer.from(item.url || title).toString("base64url").slice(0, 20)}`,
            title,
            description: description.slice(0, 500),
            date: item.startDate || "",
            endDate: item.endDate || undefined,
            location:
              item.location?.name ||
              item.location?.address?.addressLocality ||
              "London",
            url: item.url || "",
            source: "eventbrite",
            category: categorizeEvent(title, description),
            imageUrl: item.image || undefined,
          };

          events.push(event);
        }

        // Handle ItemList containing events
        if (item["@type"] === "ItemList" && Array.isArray(item.itemListElement)) {
          for (const listItem of item.itemListElement) {
            const eventItem = listItem.item || listItem;
            if (
              eventItem["@type"] !== "Event" &&
              eventItem["@type"] !== "SocialEvent"
            )
              continue;

            const title = eventItem.name || "";
            const description = eventItem.description || "";

            if (!isRelevantEvent(title, description)) continue;

            const event: FounderEvent = {
              id: `eb-${Buffer.from(eventItem.url || title).toString("base64url").slice(0, 20)}`,
              title,
              description: description.slice(0, 500),
              date: eventItem.startDate || "",
              endDate: eventItem.endDate || undefined,
              location:
                eventItem.location?.name ||
                eventItem.location?.address?.addressLocality ||
                "London",
              url: eventItem.url || "",
              source: "eventbrite",
              category: categorizeEvent(title, description),
              imageUrl: eventItem.image || undefined,
            };

            events.push(event);
          }
        }
      }
    } catch {
      // JSON parse failed — skip this block
    }
  }

  // Strategy 2: Fallback regex extraction from HTML markup
  // Eventbrite search results use predictable card patterns
  if (events.length === 0) {
    const cardRegex =
      /data-testid="[^"]*event[^"]*"[\s\S]*?href="(https:\/\/www\.eventbrite\.co\.uk\/e\/[^"]+)"[\s\S]*?<h2[^>]*>(.*?)<\/h2>[\s\S]*?<p[^>]*>(.*?)<\/p>/gi;
    let cardMatch;

    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const url = cardMatch[1] || "";
      const title = (cardMatch[2] || "").replace(/<[^>]*>/g, "").trim();
      const description = (cardMatch[3] || "").replace(/<[^>]*>/g, "").trim();

      if (!title || !isRelevantEvent(title, description)) continue;

      events.push({
        id: `eb-${Buffer.from(url || title).toString("base64url").slice(0, 20)}`,
        title,
        description: description.slice(0, 500),
        date: "",
        location: "London",
        url,
        source: "eventbrite",
        category: categorizeEvent(title, description),
      });
    }

    // Strategy 3: Simpler anchor-based extraction
    const linkRegex =
      /href="(https:\/\/www\.eventbrite\.co\.uk\/e\/([^"]+))"/gi;
    let linkMatch;
    const seenUrls = new Set(events.map((e) => e.url));

    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const url = linkMatch[1];
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      // Extract title from the slug in the URL
      const slug = linkMatch[2] || "";
      const titleFromSlug = slug
        .replace(/-tickets-\d+.*$/, "")
        .replace(/-/g, " ")
        .trim();

      if (!titleFromSlug || !isRelevantEvent(titleFromSlug, query)) continue;

      events.push({
        id: `eb-${Buffer.from(url).toString("base64url").slice(0, 20)}`,
        title: titleFromSlug.replace(/\b\w/g, (c) => c.toUpperCase()),
        description: "",
        date: "",
        location: "London",
        url,
        source: "eventbrite",
        category: categorizeEvent(titleFromSlug, query),
      });
    }
  }

  return events;
}

async function fetchEventbritePage(query: string): Promise<FounderEvent[]> {
  const url = `${BASE_URL}${encodeURIComponent(query)}/`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      console.error(
        `Eventbrite fetch failed for "${query}": ${response.status}`
      );
      return [];
    }

    const html = await response.text();
    return parseEventsFromHTML(html, query);
  } catch (error) {
    console.error(`Eventbrite fetch error for "${query}":`, error);
    return [];
  }
}

function deduplicateEvents(events: FounderEvent[]): FounderEvent[] {
  const seen = new Map<string, FounderEvent>();

  for (const event of events) {
    // Dedupe by URL first, then by normalized title
    const urlKey = event.url;
    const titleKey = event.title.toLowerCase().replace(/\s+/g, " ").trim();

    if (urlKey && seen.has(urlKey)) continue;
    if (seen.has(titleKey)) continue;

    if (urlKey) seen.set(urlKey, event);
    seen.set(titleKey, event);
  }

  // Return unique events (use URL-keyed entries to avoid title duplicates)
  const uniqueMap = new Map<string, FounderEvent>();
  for (const event of seen.values()) {
    uniqueMap.set(event.id, event);
  }

  return Array.from(uniqueMap.values());
}

export async function GET() {
  try {
    // Fetch all search queries in parallel
    const results = await Promise.allSettled(
      SEARCH_QUERIES.map((query) => fetchEventbritePage(query))
    );

    const allEvents: FounderEvent[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        allEvents.push(...result.value);
      }
    }

    const uniqueEvents = deduplicateEvents(allEvents);

    // Sort by date (events with dates first, then alphabetically by title)
    uniqueEvents.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.title.localeCompare(b.title);
    });

    return NextResponse.json({
      events: uniqueEvents,
      count: uniqueEvents.length,
      source: "eventbrite",
      queries: SEARCH_QUERIES,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Eventbrite API route error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch Eventbrite events",
        events: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
