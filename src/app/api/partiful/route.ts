import { NextResponse } from "next/server";
import {
  FounderEvent,
  isRelevantEvent,
  categorizeEvent,
} from "@/lib/types";

const PARTIFUL_URLS = [
  "https://partiful.com/discover",
  "https://partiful.com/explore",
  "https://partiful.com/discover?city=london",
  "https://partiful.com/explore?city=london",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Extract event-like blocks from raw HTML.
 * Partiful is heavily client-rendered (React/Next.js SPA), so the HTML may
 * contain very little usable markup. We try several strategies:
 *   1. JSON-LD structured data (`<script type="application/ld+json">`)
 *   2. Next.js `__NEXT_DATA__` payload
 *   3. Regex-based extraction of common event patterns in the markup
 */
function extractEventsFromHtml(html: string): FounderEvent[] {
  const events: FounderEvent[] = [];

  // --- Strategy 1: JSON-LD ---
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch: RegExpExecArray | null;
  while ((jsonLdMatch = jsonLdPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Event" || item["@type"] === "SocialEvent") {
          const title = item.name ?? "";
          const description = item.description ?? "";
          if (!isRelevantEvent(title, description)) continue;
          events.push({
            id: `partiful-ld-${Buffer.from(title).toString("base64url").slice(0, 16)}`,
            title,
            description,
            date: item.startDate ?? new Date().toISOString(),
            endDate: item.endDate ?? undefined,
            location:
              typeof item.location === "string"
                ? item.location
                : item.location?.name ?? item.location?.address ?? "London",
            url: item.url ?? "https://partiful.com",
            source: "partiful",
            category: categorizeEvent(title, description),
            imageUrl: item.image ?? undefined,
          });
        }
      }
    } catch {
      // malformed JSON-LD, skip
    }
  }

  // --- Strategy 2: __NEXT_DATA__ ---
  const nextDataPattern = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const nextDataMatch = nextDataPattern.exec(html);
  if (nextDataMatch) {
    try {
      const payload = JSON.parse(nextDataMatch[1]);
      const props = payload?.props?.pageProps;
      const eventList =
        props?.events ?? props?.discover?.events ?? props?.explore?.events ?? [];
      for (const ev of eventList) {
        const title = ev.title ?? ev.name ?? "";
        const description = ev.description ?? ev.summary ?? "";
        if (!isRelevantEvent(title, description)) continue;

        const location =
          ev.location?.name ??
          ev.location?.address ??
          ev.venue?.name ??
          ev.city ??
          "London";

        // Only include London events
        const locLower = location.toLowerCase();
        if (
          locLower !== "london" &&
          !locLower.includes("london") &&
          !locLower.includes("uk")
        ) {
          continue;
        }

        events.push({
          id: ev.id
            ? `partiful-${ev.id}`
            : `partiful-nd-${Buffer.from(title).toString("base64url").slice(0, 16)}`,
          title,
          description,
          date: ev.startDate ?? ev.date ?? ev.start ?? new Date().toISOString(),
          endDate: ev.endDate ?? ev.end ?? undefined,
          location,
          url: ev.url ?? ev.slug ? `https://partiful.com/e/${ev.slug}` : "https://partiful.com",
          source: "partiful",
          category: categorizeEvent(title, description),
          imageUrl: ev.imageUrl ?? ev.image ?? ev.coverImage ?? undefined,
        });
      }
    } catch {
      // malformed __NEXT_DATA__, skip
    }
  }

  // --- Strategy 3: Regex fallback on raw HTML ---
  // Look for patterns like event cards with titles and links
  const cardPattern =
    /href="(\/e\/[a-zA-Z0-9\-]+)"[^>]*>[\s\S]*?<(?:h[1-4]|span|div)[^>]*>([^<]{5,120})<\//gi;
  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = cardPattern.exec(html)) !== null) {
    const eventPath = cardMatch[1];
    const title = cardMatch[2].trim();
    if (!isRelevantEvent(title, "")) continue;

    const id = `partiful-html-${Buffer.from(eventPath).toString("base64url").slice(0, 16)}`;
    // Avoid duplicates
    if (events.some((e) => e.id === id)) continue;

    events.push({
      id,
      title,
      description: "",
      date: new Date().toISOString(),
      location: "London",
      url: `https://partiful.com${eventPath}`,
      source: "partiful",
      category: categorizeEvent(title, ""),
    });
  }

  return events;
}

export async function GET() {
  const allEvents: FounderEvent[] = [];
  const errors: string[] = [];

  for (const url of PARTIFUL_URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        errors.push(`${url} responded with ${res.status}`);
        continue;
      }

      const html = await res.text();
      const events = extractEventsFromHtml(html);
      allEvents.push(...events);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${url}: ${message}`);
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = allEvents.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return NextResponse.json({
    source: "partiful",
    count: unique.length,
    note:
      unique.length === 0
        ? "Partiful is heavily client-rendered (React SPA). The public discover/explore pages likely require JavaScript execution to load event data. No events could be extracted from server-rendered HTML."
        : undefined,
    errors: errors.length > 0 ? errors : undefined,
    events: unique,
  });
}
