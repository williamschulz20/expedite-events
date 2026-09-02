import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import { politeText, politeJSON, throttledBatch } from "@/lib/politeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Partiful explore pages, scraped via __NEXT_DATA__ (no auth required).
//
// Partiful has no public search API; the only anonymously-readable surface is
// partiful.com/explore/{region}. Each region page ships its whole payload in
// __NEXT_DATA__ under three buckets:
//
//   pageProps.feedItems              (~20 items)
//   pageProps.trendingSection.items  (~8 items)
//   pageProps.sections[].items       (7 curated shelves, ~40 more items)
//
// The previous version read only feedItems + trendingSection AND assumed each
// entry was a flat event object. It is not. Every entry is a *feed item*
// wrapper of the form { id: "event-<id>", type: "event", event: {...},
// tags: [] }, so `ev.title` / `ev.id` were always undefined and every
// candidate was dropped by parseRawEvent(). That, plus a hard 3-month date
// cutoff, is why the route returned 0. We now unwrap `.event`, read `sections`
// too, and keep the full rolling 365-day horizon the rest of the app uses.
// ---------------------------------------------------------------------------

const FALLBACK_SLUGS = ["sf", "nyc", "la", "lon", "atx", "bos", "chi", "dc", "mia"];

// Fallback city label per slug, used only when an event carries no address.
const SLUG_CITY: Record<string, string> = {
  sf: "San Francisco, CA",
  nyc: "New York, NY",
  la: "Los Angeles, CA",
  lon: "London, UK",
  atx: "Austin, TX",
  bos: "Boston, MA",
  chi: "Chicago, IL",
  dc: "Washington, DC",
  mia: "Miami, FL",
};

interface PartifulMapsInfo {
  name?: string;
  addressLines?: string[];
  approximateLocation?: string;
}

interface PartifulLocationInfo {
  type?: string;
  name?: string;
  address?: string;
  city?: string;
  mapsInfo?: PartifulMapsInfo;
  displayAddressLines?: string[];
  neighborhood?: string;
}

interface PartifulEventRaw {
  id?: string;
  title?: string;
  description?: string;
  locationInfo?: PartifulLocationInfo;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string;
  status?: string;
  isPublic?: boolean;
  image?: { url?: string };
  coverUrl?: string;
}

interface PartifulFeedItem {
  id?: string;
  type?: string;
  event?: PartifulEventRaw;
}

interface PartifulSection {
  id?: string;
  title?: string;
  items?: PartifulFeedItem[];
}

interface PartifulPageProps {
  region?: string;
  feedItems?: PartifulFeedItem[];
  trendingSection?: PartifulSection;
  sections?: PartifulSection[];
}

// ---------------------------------------------------------------------------
// Location: prefer the real address Partiful attaches, fall back to city hint
// ---------------------------------------------------------------------------
function buildLocation(loc: PartifulLocationInfo | undefined, cityHint: string): string {
  if (!loc) return cityHint;

  const lines =
    (loc.displayAddressLines?.length ? loc.displayAddressLines : undefined) ??
    (loc.mapsInfo?.addressLines?.length ? loc.mapsInfo.addressLines : undefined);

  const parts = [
    loc.name ?? loc.mapsInfo?.name,
    ...(lines ?? []),
    lines ? undefined : loc.address,
    lines ? undefined : (loc.city ?? loc.mapsInfo?.approximateLocation),
  ].filter((p): p is string => Boolean(p && p.trim()));

  // De-dupe repeated fragments (mapsInfo.name often repeats the first line)
  const seen = new Set<string>();
  const uniq = parts.filter((p) => {
    const k = p.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (uniq.join(", ") || loc.mapsInfo?.approximateLocation || cityHint).slice(0, 300);
}

// ---------------------------------------------------------------------------
// Normalize a start/end date to an ISO string (Partiful already emits UTC ISO)
// ---------------------------------------------------------------------------
function toIso(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function parseRawEvent(ev: PartifulEventRaw, cityHint: string): FounderEvent | null {
  const title = (ev.title ?? "").replace(/\s+/g, " ").trim();
  if (!title || !ev.id) return null;
  if (ev.status && ev.status !== "PUBLISHED") return null;

  const description = (ev.description ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 800);
  const sc = scoreLeadQuality(title, description);

  return {
    id: `partiful-${ev.id}`,
    title: title.slice(0, 200),
    description,
    date: toIso(ev.startDate),
    endDate: toIso(ev.endDate) || undefined,
    location: buildLocation(ev.locationInfo, cityHint),
    url: `https://partiful.com/e/${ev.id}`,
    source: "partiful",
    category: categorizeEvent(title, description),
    imageUrl: ev.image?.url ?? ev.coverUrl ?? undefined,
    leadScore: sc.score,
    leadTier: sc.tier,
    highLeverage: sc.highLeverage,
    leverageReason: sc.leverageReason,
  };
}

// ---------------------------------------------------------------------------
// Pull every event out of an explore page payload
// ---------------------------------------------------------------------------
function eventsFromPageProps(props: PartifulPageProps, cityHint: string): FounderEvent[] {
  const buckets: PartifulFeedItem[] = [
    ...(Array.isArray(props.feedItems) ? props.feedItems : []),
    ...(Array.isArray(props.trendingSection?.items) ? props.trendingSection.items : []),
    ...(Array.isArray(props.sections)
      ? props.sections.flatMap((s) => (Array.isArray(s?.items) ? s.items : []))
      : []),
  ];

  const seen = new Set<string>();
  const events: FounderEvent[] = [];

  for (const item of buckets) {
    // Feed items wrap the event; tolerate a flat shape too in case it changes back.
    const raw = item?.event ?? (item as PartifulEventRaw | undefined);
    if (!raw) continue;
    const evt = parseRawEvent(raw, cityHint);
    if (evt && !seen.has(evt.id)) {
      seen.add(evt.id);
      events.push(evt);
    }
  }

  return events;
}

function extractNextData(html: string): PartifulPageProps | null {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const nd = JSON.parse(match[1]);
    return (nd?.props?.pageProps ?? null) as PartifulPageProps | null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discover the current buildId + live region list from /explore.
// The buildId lets us hit the small JSON payload (~230KB) instead of the full
// HTML page (up to 1.2MB for NYC). Both are refreshed on every deploy, so we
// read it at request time rather than hardcoding it.
// ---------------------------------------------------------------------------
async function discoverExplore(): Promise<{ buildId: string | null; slugs: string[] }> {
  const html = await politeText("https://partiful.com/explore");
  if (!html) return { buildId: null, slugs: FALLBACK_SLUGS };

  const buildMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/);
  const found = Array.from(html.matchAll(/\/explore\/([a-z0-9-]{2,20})/g)).map((m) => m[1]);
  const slugs = Array.from(new Set(found.length ? found : FALLBACK_SLUGS));

  return { buildId: buildMatch?.[1] ?? null, slugs };
}

async function scrapeExplorePage(slug: string, buildId: string | null): Promise<FounderEvent[]> {
  const cityHint = SLUG_CITY[slug] ?? slug.toUpperCase();

  // Preferred: the Next.js data endpoint (small JSON).
  if (buildId) {
    const data = await politeJSON<{ pageProps?: PartifulPageProps }>(
      `https://partiful.com/_next/data/${buildId}/explore/${slug}.json?region=${slug}`,
      { retries: 2 }
    );
    if (data?.pageProps) {
      const evts = eventsFromPageProps(data.pageProps, cityHint);
      if (evts.length > 0) return evts;
    }
  }

  // Fallback: full HTML page, same payload embedded in __NEXT_DATA__.
  const html = await politeText(`https://partiful.com/explore/${slug}`);
  if (!html) return [];
  const props = extractNextData(html);
  if (!props) return [];
  return eventsFromPageProps(props, cityHint);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const { buildId, slugs } = await discoverExplore();

    // Low concurrency + pauses: Partiful throttles hard.
    const perRegion = await throttledBatch(
      slugs.map((slug) => async () => ({ slug, events: await scrapeExplorePage(slug, buildId) })),
      { concurrency: 3, pauseMs: 700 }
    );

    const all: FounderEvent[] = [];
    const seen = new Set<string>();
    const byRegion: Record<string, number> = {};

    for (const { slug, events } of perRegion) {
      byRegion[slug] = events.length;
      for (const evt of events) {
        if (!seen.has(evt.id)) {
          seen.add(evt.id);
          all.push(evt);
        }
      }
    }

    // Rolling 365-day horizon, matching the rest of the app. The old 3-month
    // cutoff threw away everything Partiful publishes further out.
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() + 1);

    const filtered = all.filter((e) => {
      if (!e.title) return false;
      // Only events with a real founder/startup signal are worth storing.
      if ((e.leadScore ?? 0) <= 0) return false;
      if (!e.date) return true;
      const d = new Date(e.date);
      if (isNaN(d.getTime())) return true;
      return d >= now && d <= cutoff;
    });

    filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({
      source: "partiful",
      count: filtered.length,
      scanned: all.length,
      cities: slugs,
      byRegion,
      events: filtered,
    });
  } catch (error) {
    console.error("Partiful route error:", error);
    return NextResponse.json({ source: "partiful", count: 0, events: [] });
  }
}
