import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";
import { politeText, sleep } from "@/lib/politeFetch";

// ---------------------------------------------------------------------------
// Search queries × multiple cities × multiple pages = broad coverage
// ---------------------------------------------------------------------------
// SEARCH_QUERIES are ordered BEST-FIRST on purpose: the bounded sweep takes
// SEARCH_QUERIES.slice(0, maxQueries) (default 14), so the highest-yield terms
// for O-1A-eligible founders must sit at the top. Terms are chosen to land on
// the HOT/WARM keyword groups in scoreLeadQuality() — demo days, pitch nights,
// investor rooms, accelerators, founder dinners — rather than generic "tech".
const SEARCH_QUERIES = [
  // ordered best-first: a bounded sweep takes the first N
  "startup", "founder", "demo day", "pitch night", "venture capital",
  "hackathon", "accelerator", "investor meetup", "founders networking",
  "tech conference", "AI meetup", "startup pitch", "founder dinner",
  "seed funding", "angel investor", "startup networking", "scaleup",
  "entrepreneur", "incubator", "startup summit", "tech summit",
  "founder breakfast", "AI conference", "fintech", "deep tech",
  "SaaS founders", "product hunt", "startup weekend", "YC",
  "pre-seed", "series A", "startup grind", "tech meetup",
  "co-founder matching", "startup job fair", "US expansion",
  "international founders", "global talent", "immigrant founders",
  "biotech startup", "climate tech", "web3 founders", "developer conference",
  "innovation summit", "unicorn", "growth hacking",
];

// Eventbrite place slugs. The `country--city` form is a real alias that 302s to
// the canonical slug (united-states--seattle -> wa--seattle,
// poland--warsaw -> poland--warszawa, italy--milan -> italy--milano), and
// politeText follows redirects, so English exonyms are safe to use here.
// Washington DC has no unambiguous country-form alias (united-states--washington
// collides with the state), so it uses its canonical dc--washington slug.
// eventbrite.com serves every place slug; the country domains below are only
// the ones already proven against this scraper. Ordered best-first by founder
// density so a truncated sweep still hits the strongest markets.
const CITIES = [
  { slug: "united-states--san-francisco", label: "San Francisco", domain: "eventbrite.com" },
  { slug: "united-kingdom--london",       label: "London",        domain: "eventbrite.co.uk" },
  { slug: "united-states--new-york",      label: "New York",      domain: "eventbrite.com" },
  { slug: "germany--berlin",              label: "Berlin",        domain: "eventbrite.de" },
  { slug: "united-states--boston",        label: "Boston",        domain: "eventbrite.com" },
  { slug: "france--paris",                label: "Paris",         domain: "eventbrite.fr" },
  { slug: "united-states--austin",        label: "Austin",        domain: "eventbrite.com" },
  { slug: "united-states--seattle",       label: "Seattle",       domain: "eventbrite.com" },
  { slug: "united-states--los-angeles",   label: "Los Angeles",   domain: "eventbrite.com" },
  { slug: "netherlands--amsterdam",       label: "Amsterdam",     domain: "eventbrite.nl" },
  { slug: "canada--toronto",              label: "Toronto",       domain: "eventbrite.ca" },
  { slug: "united-states--san-jose",      label: "San Jose",      domain: "eventbrite.com" },
  { slug: "united-states--miami",         label: "Miami",         domain: "eventbrite.com" },
  { slug: "united-states--chicago",       label: "Chicago",       domain: "eventbrite.com" },
  { slug: "ireland--dublin",              label: "Dublin",        domain: "eventbrite.ie" },
  { slug: "sweden--stockholm",            label: "Stockholm",     domain: "eventbrite.com" },
  { slug: "spain--barcelona",             label: "Barcelona",     domain: "eventbrite.es" },
  { slug: "germany--munich",              label: "Munich",        domain: "eventbrite.de" },
  { slug: "dc--washington",               label: "Washington DC", domain: "eventbrite.com" },
  { slug: "switzerland--zurich",          label: "Zurich",        domain: "eventbrite.com" },
  { slug: "portugal--lisbon",             label: "Lisbon",        domain: "eventbrite.pt" },
  { slug: "denmark--copenhagen",          label: "Copenhagen",    domain: "eventbrite.com" },
  { slug: "finland--helsinki",            label: "Helsinki",      domain: "eventbrite.com" },
  { slug: "estonia--tallinn",             label: "Tallinn",       domain: "eventbrite.com" },
  { slug: "canada--vancouver",            label: "Vancouver",     domain: "eventbrite.ca" },
  { slug: "united-kingdom--cambridge",    label: "Cambridge",     domain: "eventbrite.co.uk" },
  { slug: "spain--madrid",                label: "Madrid",        domain: "eventbrite.es" },
  { slug: "united-states--denver",        label: "Denver",        domain: "eventbrite.com" },
  { slug: "italy--milan",                 label: "Milan",         domain: "eventbrite.it" },
  { slug: "united-kingdom--manchester",   label: "Manchester",    domain: "eventbrite.co.uk" },
  { slug: "norway--oslo",                 label: "Oslo",          domain: "eventbrite.com" },
  { slug: "austria--vienna",              label: "Vienna",        domain: "eventbrite.at" },
  { slug: "poland--warsaw",               label: "Warsaw",        domain: "eventbrite.com" },
  { slug: "canada--montreal",             label: "Montreal",      domain: "eventbrite.ca" },
  { slug: "united-kingdom--edinburgh",    label: "Edinburgh",     domain: "eventbrite.co.uk" },
  { slug: "united-states--san-diego",     label: "San Diego",     domain: "eventbrite.com" },
  { slug: "germany--hamburg",             label: "Hamburg",       domain: "eventbrite.de" },
  { slug: "united-states--atlanta",       label: "Atlanta",       domain: "eventbrite.com" },
  { slug: "belgium--brussels",            label: "Brussels",      domain: "eventbrite.com" },
  { slug: "czech-republic--prague",       label: "Prague",        domain: "eventbrite.com" },
  { slug: "united-kingdom--oxford",       label: "Oxford",        domain: "eventbrite.co.uk" },
  { slug: "latvia--riga",                 label: "Riga",          domain: "eventbrite.com" },
  { slug: "lithuania--vilnius",           label: "Vilnius",       domain: "eventbrite.com" },
  { slug: "germany--frankfurt",           label: "Frankfurt",     domain: "eventbrite.de" },
  { slug: "united-states--dallas",        label: "Dallas",        domain: "eventbrite.com" },
  { slug: "hungary--budapest",            label: "Budapest",      domain: "eventbrite.com" },
];

// Pages to fetch per query — gets us events further into the future
const PAGES_PER_QUERY = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------------------
// Fetch one page of Eventbrite search results
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// String-aware brace scan. Needed because two JSON objects share one <script>
// tag, so no regex ending at </script> can isolate the first one.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractServerData(html: string): any | null {
  const m = /window\.__SERVER_DATA__\s*=\s*/.exec(html);
  if (!m) return null;
  const start = html.indexOf("{", m.index + m[0].length - 1);
  if (start < 0) return null;

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (--depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function fetchEventbritePage(
  citySlug: string,
  cityLabel: string,
  query: string,
  page: number,
  domain: string = "eventbrite.co.uk"
): Promise<FounderEvent[]> {
  const events: FounderEvent[] = [];

  try {
    const url = `https://www.${domain}/d/${citySlug}/${encodeURIComponent(query)}/?page=${page}`;

    const html = await politeText(url);
    if (!html) return events;

    // Eventbrite inlines __SERVER_DATA__ and __REACT_QUERY_STATE__ in the SAME
    // <script> tag. A lazy regex anchored on </script> runs straight through the
    // first object into the second, so JSON.parse throws and the old catch {}
    // swallowed it: that is why this returned 0 events. Scan braces instead.
    const sd = extractServerData(html);

    const results = [
      ...(sd?.search_data?.events?.results ?? []),
      ...(sd?.search_data?.events?.promoted_results ?? []),
    ] as Array<Record<string, unknown>>;

    if (results.length > 0) {
      const seen = new Set<string>();
      for (const e of results) {
        const rawUrl = (e.url as string) ?? "";
        if (!rawUrl) continue;
        const cleanUrl = rawUrl.split("?")[0];
        if (seen.has(cleanUrl)) continue;
        seen.add(cleanUrl);

        const venue = (e.primary_venue ?? {}) as Record<string, unknown>;
        const addr = (venue.address ?? {}) as Record<string, unknown>;
        const startDate = e.start_date as string | undefined;
        const startTime = e.start_time as string | undefined;
        const endDate = e.end_date as string | undefined;
        const endTime = e.end_time as string | undefined;

        const title = (e.name as string) ?? "";
        const desc = ((e.summary as string) || (e.full_description as string) || "").slice(0, 500);

        events.push({
          id: `eb-${(e.eventbrite_event_id as string) ?? (e.id as string) ?? hashString(cleanUrl)}`,
          title,
          description: desc,
          // start_time is venue-local; keep date+time together so the calendar
          // does not collapse everything to midnight.
          date: startDate ? (startTime ? `${startDate}T${startTime}` : startDate) : "",
          endDate: endDate ? (endTime ? `${endDate}T${endTime}` : endDate) : undefined,
          location: e.is_online_event
            ? "Online"
            : ((venue.name as string) ||
               (addr.localized_address_display as string) ||
               (addr.localized_area_display as string) ||
               (addr.city as string) ||
               cityLabel),
          url: cleanUrl,
          source: "eventbrite",
          category: categorizeEvent(title, desc),
          imageUrl: ((e.image as Record<string, unknown>)?.url as string) || undefined,
        } as FounderEvent);
      }
      return events;
    }

    // Fallback: the standalone schema.org block. Carries the 20 organic results
    // but no promoted ones, and no clock time.
    const jsonLdBlocks = [...html.matchAll(
      /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )];
    for (const match of jsonLdBlocks) {
      try {
        const ld = JSON.parse(match[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          const list = item["@type"] === "ItemList" ? (item.itemListElement ?? []) : [];
          for (const li of list) {
            const evt = li.item || li;
            if (evt["@type"] !== "Event" && evt["@type"] !== "SocialEvent") continue;
            const title = evt.name || "";
            const desc = (evt.description || "").slice(0, 500);
            events.push({
              id: `eb-${hashString(evt.url || title)}`,
              title,
              description: desc,
              date: evt.startDate || "",
              endDate: evt.endDate || undefined,
              location:
                evt.location?.name ||
                evt.location?.address?.streetAddress ||
                evt.location?.address?.addressLocality ||
                cityLabel,
              url: (evt.url || "").split("?")[0],
              source: "eventbrite",
              category: categorizeEvent(title, desc),
              imageUrl: typeof evt.image === "string" ? evt.image : evt.image?.url || undefined,
            } as FounderEvent);
          }
        }
      } catch { /* skip malformed block */ }
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
export async function GET(request: Request) {
  try {
    // 46 cities x 46 queries x 5 pages = 10,580 requests, which cannot finish
    // inside any sane budget and just gets us blocked. Default to a bounded
    // sweep; ?pages=5&queries=46 still does the deep run.
    // All three lists are ordered best-first, so slicing keeps the strongest
    // markets and the highest-signal terms.
    const sp = new URL(request.url).searchParams;
    const maxPages = Math.max(1, Math.min(5, Number(sp.get("pages")) || 2));
    const maxQueries = Math.max(1, Math.min(SEARCH_QUERIES.length, Number(sp.get("queries")) || 14));
    // ?cities=N bounds the city sweep for smoke tests. Default is every city,
    // so this changes no existing behaviour.
    const maxCities = Math.max(1, Math.min(CITIES.length, Number(sp.get("cities")) || CITIES.length));
    const queries = SEARCH_QUERIES.slice(0, maxQueries);
    const pages = PAGES_PER_QUERY.slice(0, maxPages);
    const cities = CITIES.slice(0, maxCities);

    const allEvents: FounderEvent[] = [];

    // For each city, run all queries across all pages in parallel batches
    // Batch size of 8 to avoid hammering Eventbrite
    for (const city of cities) {
      const tasks: Array<() => Promise<FounderEvent[]>> = [];
      for (const query of queries) {
        for (const page of pages) {
          tasks.push(() => fetchEventbritePage(city.slug, city.label, query, page, city.domain));
        }
      }

      // Run in batches of 8 concurrent requests
      for (let i = 0; i < tasks.length; i += 4) {
        const batch = tasks.slice(i, i + 4).map((t) => t());
        if (i > 0) await sleep(300 + Math.random() * 300);
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
      // Identical to CITIES.length on a default sweep; differs only when the
      // caller passed ?cities=N.
      cities: cities.length,
      cities_configured: CITIES.length,
      queries_used: queries.length,
      queries_configured: SEARCH_QUERIES.length,
      pages_per_query: pages.length,
    });
  } catch (error) {
    console.error("Eventbrite error:", error);
    return NextResponse.json({ events: [], count: 0, source: "eventbrite" });
  }
}
