import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Partiful explore pages — scraped via __NEXT_DATA__ (no auth required)
// Each slug maps to partiful.com/explore/{slug}
// ---------------------------------------------------------------------------
const EXPLORE_SLUGS = ["lon", "sf"];

interface PartifulLocationInfo {
  name?: string;
  address?: string;
  city?: string;
}

interface PartifulEventRaw {
  id?: string;
  title?: string;
  description?: string;
  locationInfo?: PartifulLocationInfo;
  startDate?: string;
  endDate?: string;
  timezone?: string;
  image?: { url?: string };
  coverUrl?: string;
}

// Map slug → human city name for fallback location
const SLUG_CITY: Record<string, string> = {
  lon: "London",
  sf: "San Francisco",
};

function parseRawEvent(ev: PartifulEventRaw, cityHint: string): FounderEvent | null {
  const title = (ev.title ?? "").trim();
  if (!title || !ev.id) return null;

  const description = (ev.description ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 800);

  const loc = ev.locationInfo;
  const locationParts = [loc?.name, loc?.address, loc?.city ?? cityHint].filter(Boolean);
  const location = (locationParts.join(", ") || cityHint).slice(0, 300);

  return {
    id: `partiful-${ev.id}`,
    title: title.slice(0, 200),
    description,
    date: ev.startDate ?? "",
    endDate: ev.endDate ?? undefined,
    location,
    url: `https://partiful.com/e/${ev.id}`,
    source: "partiful",
    category: categorizeEvent(title, description),
    imageUrl: ev.image?.url ?? ev.coverUrl ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Scrape a single explore page via __NEXT_DATA__
// ---------------------------------------------------------------------------
async function scrapeExplorePage(slug: string): Promise<FounderEvent[]> {
  const cityHint = SLUG_CITY[slug] ?? slug;

  try {
    const res = await fetch(`https://partiful.com/explore/${slug}`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return [];

    const html = await res.text();
    const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return [];

    const nd = JSON.parse(match[1]);
    const props = nd?.props?.pageProps ?? {};

    // Collect from feedItems + trendingSection
    const feedItems: PartifulEventRaw[] = Array.isArray(props.feedItems) ? props.feedItems : [];
    const trending: PartifulEventRaw[] = Array.isArray(props.trendingSection?.items)
      ? props.trendingSection.items
      : [];

    const seen = new Set<string>();
    const events: FounderEvent[] = [];

    for (const raw of [...feedItems, ...trending]) {
      const evt = parseRawEvent(raw, cityHint);
      if (evt && !seen.has(evt.id)) {
        seen.add(evt.id);
        events.push(evt);
      }
    }

    return events;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const results = await Promise.allSettled(EXPLORE_SLUGS.map(scrapeExplorePage));

    const all: FounderEvent[] = [];
    const seen = new Set<string>();

    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const evt of r.value) {
          if (!seen.has(evt.id)) {
            seen.add(evt.id);
            all.push(evt);
          }
        }
      }
    }

    // Filter: future events only
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() + 3);

    const filtered = all.filter((e) => {
      if (!e.title || !e.date) return false;
      const d = new Date(e.date);
      return d >= now && d <= cutoff;
    });

    filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({
      source: "partiful",
      count: filtered.length,
      cities: EXPLORE_SLUGS,
      events: filtered,
    });
  } catch (error) {
    console.error("Partiful route error:", error);
    return NextResponse.json({ source: "partiful", count: 0, events: [] });
  }
}
