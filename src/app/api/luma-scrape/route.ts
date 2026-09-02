import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import { politeJSON, sleep } from "@/lib/politeFetch";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Luma scraper.
//
// The old version parsed a city's HTML page, which only ever exposes the next
// ~20 events. That capped coverage at a few weeks. Luma's discover API is
// cursor-paginated, so we can walk a full 365 days per city and pick up the
// host list (the "champions") along the way.
// ---------------------------------------------------------------------------

const CACHE_FILE = path.join(process.cwd(), "luma-cache.json");
const PLACES_FILE = path.join(process.cwd(), ".data", "luma-places.json");

// Luma's own discover slugs, not city names: New York is "nyc", San Francisco
// is "sf". Ids for these are cached in .data/luma-places.json by
// scripts/resolve-places.mjs.
const CITIES = [
  // North America
  "nyc", "sf", "la", "bay-area", "palo-alto", "brooklyn", "seattle", "austin",
  "boston", "chicago", "miami", "denver", "toronto", "vancouver", "montreal",
  "atlanta", "dc", "philadelphia", "san-diego", "dallas", "houston", "portland",
  "phoenix", "nashville", "slc", "pittsburgh", "detroit", "minneapolis",
  "boulder", "raleigh", "san-jose",
  // Europe
  "london", "berlin", "paris", "amsterdam", "munich", "barcelona", "lisbon",
  "stockholm", "helsinki", "dublin", "zurich", "copenhagen", "vienna", "madrid",
  "warsaw", "brussels", "geneva", "hamburg", "milan", "rome", "budapest",
  "prague", "tallinn", "oslo", "manchester", "edinburgh", "cambridge", "oxford",
  "bristol", "porto", "valencia", "krakow", "bucharest", "sofia", "athens",
  "istanbul", "riga", "vilnius", "ljubljana", "zagreb", "luxembourg",
  "rotterdam", "eindhoven", "cologne", "frankfurt", "stuttgart", "dusseldorf",
  "leipzig", "lyon", "marseille", "turin", "florence", "naples", "seville",
  "malaga", "bilbao", "gothenburg", "malmo", "aarhus", "bergen", "reykjavik",
  "belfast", "glasgow", "leeds",
];

// Rolling one-year horizon, recomputed on every run.
const HORIZON_DAYS = 365;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_CITY = 14;

function loadCache(): FounderEvent[] {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {}
  return [];
}
function saveCache(events: FounderEvent[]) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(events, null, 2)); } catch {}
}

function loadPlaces(): Record<string, string> {
  try {
    if (fs.existsSync(PLACES_FILE)) return JSON.parse(fs.readFileSync(PLACES_FILE, "utf-8"));
  } catch {}
  return {};
}
function savePlaces(p: Record<string, string>) {
  try {
    fs.mkdirSync(path.dirname(PLACES_FILE), { recursive: true });
    fs.writeFileSync(PLACES_FILE, JSON.stringify(p, null, 2));
  } catch {}
}

/** A city's discover-place id, resolved once via the JSON API and cached. */
async function resolvePlaceId(slug: string, places: Record<string, string>): Promise<string | null> {
  if (places[slug]) return places[slug];
  const data = await politeJSON<{ place?: { api_id?: string } }>(
    `https://api.lu.ma/discover/get-place?slug=${encodeURIComponent(slug)}`
  );
  const id = data?.place?.api_id;
  if (typeof id === "string" && id) {
    places[slug] = id;
    return id;
  }
  return null;
}

type LumaHost = { api_id?: string; name?: string; username?: string };
type LumaEntry = {
  event?: {
    api_id?: string; name?: string; start_at?: string; end_at?: string;
    url?: string; cover_url?: string; geo_address_info?: { city_state?: string; full_address?: string; city?: string };
  };
  hosts?: LumaHost[];
  guest_count?: number;
  cover_image?: { url?: string };
};
type LumaPage = { entries?: LumaEntry[]; has_more?: boolean; next_cursor?: string | null };

/** Walk one city's events forward until the horizon or the pages run out. */
async function fetchCity(slug: string, placeId: string, cityLabel: string, horizon: Date) {
  const out: FounderEvent[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES_PER_CITY; page++) {
    const url: string =
      `https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=${encodeURIComponent(placeId)}` +
      `&pagination_limit=${PAGE_SIZE}` +
      (cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : "");

    const data: LumaPage | null = await politeJSON<LumaPage>(url);
    if (!data?.entries?.length) break;

    let pastHorizon = false;
    for (const entry of data.entries) {
      const ev = entry.event;
      if (!ev?.api_id || !ev.name) continue;
      const startsAt = ev.start_at ?? "";
      if (startsAt && new Date(startsAt) > horizon) { pastHorizon = true; continue; }

      const host = entry.hosts?.[0];
      const geo = ev.geo_address_info ?? {};
      const location = geo.city_state || geo.city || geo.full_address || cityLabel;
      const title = ev.name;
      const desc = "";
      const sc = scoreLeadQuality(title, desc);

      out.push({
        id: `luma-${ev.api_id}`,
        title,
        description: desc,
        date: startsAt,
        endDate: ev.end_at || undefined,
        location,
        url: ev.url?.startsWith("http") ? ev.url : `https://luma.com/${ev.url ?? ev.api_id}`,
        source: "luma",
        category: categorizeEvent(title, desc),
        imageUrl: ev.cover_url || entry.cover_image?.url || undefined,
        leadScore: sc.score,
        leadTier: sc.tier,
        highLeverage: sc.highLeverage,
        leverageReason: sc.leverageReason,
        organizerName: host?.name,
        organizerLumaId: host?.api_id,
        organizerUsername: host?.username,
      } as FounderEvent);
    }

    if (pastHorizon || !data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor ?? null;
    await sleep(250 + Math.random() * 250);
  }
  return out;
}

export async function GET() {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  const places = loadPlaces();
  const existing = loadCache();
  const byId = new Map(existing.map((e) => [e.id, e]));
  const cityResults: Record<string, number> = {};

  // Two cities at a time keeps us under Luma's rate limit.
  for (let i = 0; i < CITIES.length; i += 2) {
    const batch = CITIES.slice(i, i + 2);
    if (i > 0) await sleep(500 + Math.random() * 500);

    const results = await Promise.allSettled(
      batch.map(async (slug) => {
        const placeId = await resolvePlaceId(slug, places);
        if (!placeId) return { slug, events: [] as FounderEvent[] };
        const label = slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
        return { slug, events: await fetchCity(slug, placeId, label, horizon) };
      })
    );

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      cityResults[r.value.slug] = r.value.events.length;
      // Later sightings win, so organizer enrichment is not lost.
      for (const e of r.value.events) byId.set(e.id, e);
    }
  }

  savePlaces(places);
  const all = Array.from(byId.values());
  saveCache(all);

  return NextResponse.json({
    events: all,
    count: all.length,
    cities: cityResults,
    horizon_days: HORIZON_DAYS,
    source: "luma-scrape",
  });
}
