import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Search queries × multiple cities × multiple pages = broad coverage
// ---------------------------------------------------------------------------
const SEARCH_QUERIES = [
  "hackathon",
  "startup",
  "founder",
  "demo day",
  "pitch night",
  "investor meetup",
  "accelerator",
  "entrepreneur",
  "AI meetup",
  "fintech",
  "venture capital",
  "tech networking",
  "startup launch",
  "SaaS founders",
  "tech conference",
  "startup conference",
  "tech summit",
  "innovation",
  "founder dinner",
  "founder breakfast",
  "startup dinner",
  "tech dinner networking",
  "CEO breakfast",
  "investor dinner",
  "workshop tech",
  "blockchain",
  "deep tech",
];

const CITIES = [
  { slug: "united-kingdom--london",   label: "London" },
  { slug: "germany--berlin",          label: "Berlin" },
  { slug: "france--paris",            label: "Paris" },
  { slug: "netherlands--amsterdam",   label: "Amsterdam" },
  { slug: "united-states--san-francisco", label: "San Francisco" },
  { slug: "estonia--tallinn",         label: "Tallinn" },
  { slug: "sweden--stockholm",        label: "Stockholm" },
  { slug: "finland--helsinki",         label: "Helsinki" },
  { slug: "ireland--dublin",          label: "Dublin" },
  { slug: "portugal--lisbon",         label: "Lisbon" },
  { slug: "spain--barcelona",         label: "Barcelona" },
  { slug: "switzerland--zurich",      label: "Zurich" },
  { slug: "austria--vienna",          label: "Vienna" },
  { slug: "norway--oslo",             label: "Oslo" },
  { slug: "latvia--riga",             label: "Riga" },
];

// Pages to fetch per query — gets us events further into the future
const PAGES_PER_QUERY = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------------------
// Fetch one page of Eventbrite search results
// ---------------------------------------------------------------------------
async function fetchEventbritePage(
  citySlug: string,
  cityLabel: string,
  query: string,
  page: number
): Promise<FounderEvent[]> {
  const events: FounderEvent[] = [];

  try {
    const url = `https://www.eventbrite.co.uk/d/${citySlug}/${encodeURIComponent(query)}/?page=${page}&lang=en-gb`;

    const res = await fetch(url, {
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

    // Stop paginating if Eventbrite returns a "no results" or redirect page
    if (html.includes("no-results") || html.includes("No Results Found")) return events;

    // Strategy 1: window.__SERVER_DATA__
    const serverDataMatch = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/);
    if (serverDataMatch) {
      try {
        const serverData = JSON.parse(serverDataMatch[1]);
        const results =
          serverData?.search_data?.events?.results ||
          serverData?.jsonld?.events ||
          [];
        for (const evt of results) {
          events.push(mapEventbriteEvent(evt, cityLabel));
        }
      } catch { /* parse failed */ }
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
                    cityLabel,
                  url: evt.url || "",
                  source: "eventbrite",
                  category: categorizeEvent(evt.name || "", evt.description || ""),
                  imageUrl: typeof evt.image === "string" ? evt.image : evt.image?.url || undefined,
                });
              }
            }
          }
          if (item["@type"] === "Event" || item["@type"] === "SocialEvent") {
            events.push({
              id: `eb-${hashString(item.url || item.name || "")}`,
              title: item.name || "",
              description: (item.description || "").slice(0, 500),
              date: item.startDate || "",
              endDate: item.endDate || undefined,
              location:
                item.location?.name ||
                item.location?.address?.addressLocality ||
                cityLabel,
              url: item.url || "",
              source: "eventbrite",
              category: categorizeEvent(item.name || "", item.description || ""),
              imageUrl: typeof item.image === "string" ? item.image : item.image?.url || undefined,
            });
          }
        }
      } catch { /* skip */ }
    }

    // Strategy 3: event URLs from links (fallback, title-only)
    const seenUrls = new Set(events.map((e) => e.url));
    const linkPattern = /href="(https:\/\/www\.eventbrite\.co\.uk\/e\/([^"?]+)[^"]*)"/gi;
    let linkMatch;
    while ((linkMatch = linkPattern.exec(html)) !== null) {
      const evtUrl = linkMatch[1];
      if (seenUrls.has(evtUrl)) continue;
      seenUrls.add(evtUrl);

      const slug = linkMatch[2] || "";
      const title = slug
        .replace(/-tickets-\d+.*$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();

      if (!title || title.length < 5) continue;

      events.push({
        id: `eb-${hashString(evtUrl)}`,
        title,
        description: "",
        date: "",
        location: cityLabel,
        url: evtUrl,
        source: "eventbrite",
        category: categorizeEvent(title, query),
      });
    }
  } catch { /* query failed */ }

  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mapEventbriteEvent(evt: Record<string, unknown>, cityLabel: string): FounderEvent {
  const title = (evt.name as string) || (evt.title as string) || "";
  const description = (evt.description as string) || (evt.summary as string) || "";
  const url = (evt.url as string) || "";
  const startDate = (evt.start_date as string) || (evt.start as string) || "";
  const venue = evt.venue as Record<string, unknown> | undefined;
  const location = venue
    ? (venue.name as string) || (venue.address as string) || cityLabel
    : cityLabel;

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
    imageUrl: (evt.image_url as string) || (evt.logo_url as string) || undefined,
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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const allEvents: FounderEvent[] = [];

    // For each city, run all queries across all pages in parallel batches
    // Batch size of 8 to avoid hammering Eventbrite
    for (const city of CITIES) {
      const tasks: Array<Promise<FounderEvent[]>> = [];
      for (const query of SEARCH_QUERIES) {
        for (const page of PAGES_PER_QUERY) {
          tasks.push(fetchEventbritePage(city.slug, city.label, query, page));
        }
      }

      // Run in batches of 8 concurrent requests
      for (let i = 0; i < tasks.length; i += 8) {
        const batch = tasks.slice(i, i + 8);
        const results = await Promise.allSettled(batch);
        for (const r of results) {
          if (r.status === "fulfilled") allEvents.push(...r.value);
        }
      }
    }

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
      cities: CITIES.length,
      pages_per_query: PAGES_PER_QUERY.length,
    });
  } catch (error) {
    console.error("Eventbrite error:", error);
    return NextResponse.json({ events: [], count: 0, source: "eventbrite" });
  }
}
