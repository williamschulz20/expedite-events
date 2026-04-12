import { NextResponse } from "next/server";
import { FounderEvent, scoreLeadQuality, LeadScore } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const MASTER_CACHE = path.join(process.cwd(), "events-cache.json");

// ---- helpers ----

function loadMasterCache(): FounderEvent[] {
  try {
    if (fs.existsSync(MASTER_CACHE)) {
      return JSON.parse(fs.readFileSync(MASTER_CACHE, "utf-8"));
    }
  } catch {}
  return [];
}

function saveMasterCache(events: FounderEvent[]) {
  fs.writeFileSync(MASTER_CACHE, JSON.stringify(events, null, 2));
}

function loadFileCache(name: string): FounderEvent[] {
  try {
    const p = path.join(process.cwd(), `${name}-cache.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {}
  return [];
}

function remapSource(externalId: string, dbSource: string): string {
  if (dbSource !== "luma") return dbSource;
  if (externalId.startsWith("eb-")) return "eventbrite";
  if (externalId.startsWith("conf-")) return "confstech";
  if (externalId.startsWith("devev-")) return "devevents";
  if (externalId.startsWith("f6s-")) return "f6s";
  if (externalId.startsWith("gg-")) return "garysguide";
  if (externalId.startsWith("gsearch-")) return "googlesearch";
  if (externalId.startsWith("web-")) return "websearch";
  if (externalId.startsWith("10t-")) return "tentimes";
  if (externalId.startsWith("sg-")) return "startupgrind";
  if (externalId.startsWith("selectusa-")) return "selectusa";
  if (externalId.startsWith("uni-")) return "university";
  if (externalId.startsWith("partiful-")) return "partiful";
  const confIds = ["latitude59", "slush", "web-summit", "tnw", "noah", "viva", "collision", "techcrunch", "rise-conf", "wolves", "arctic15", "login-", "riga-comm", "oslo-innovation", "sifted", "london-tech-week", "bits-pretzels", "pirate-summit", "pioneers", "south-summit", "websummit", "startup-grind", "tech-open-air", "tallinn-digital"];
  if (confIds.some((c) => externalId.startsWith(c))) return "conference";
  return "luma";
}

function extractCity(location: string): string {
  if (!location) return "";
  const loc = location.toLowerCase();
  const KNOWN_CITIES = [
    "London", "Berlin", "Paris", "Amsterdam", "San Francisco",
    "Munich", "Barcelona", "Zurich", "Stockholm", "Helsinki",
    "Lisbon", "Dublin", "Copenhagen", "Milan", "Madrid",
    "Istanbul", "Vienna", "Warsaw", "Brussels", "Hamburg",
    "Budapest", "Prague", "Geneva", "Lausanne", "Rome",
    "Los Angeles", "New York", "Austin", "Boston", "Oslo",
    "Tallinn", "Riga",
  ];
  if (loc.includes("san francisco") || loc.includes(", ca ") || loc.includes("sf,")) return "San Francisco";
  for (const city of KNOWN_CITIES) {
    if (loc.includes(city.toLowerCase())) return city;
  }
  return "";
}

// ---- main handler ----

export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin;
  const refresh = new URL(request.url).searchParams.get("refresh") === "true";

  // STEP 1: Try Supabase cache first (includes accepted/attended state)
  if (!refresh) {
    try {
      const { data: cached } = await supabase
        .from("scraped_events")
        .select("*")
        .gte("starts_at", new Date().toISOString())
        .lte("starts_at", new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString())
        .order("starts_at", { ascending: true });

      if (cached && cached.length > 0) {
        const events = dedup(cached.map(rowToEvent));
        return NextResponse.json({ events, total: events.length, source: "supabase", deduped: cached.length - events.length });
      }
    } catch {}
  }

  // STEP 2: Try local master cache (instant, no network)
  if (!refresh) {
    const masterCached = loadMasterCache();
    if (masterCached.length > 0) {
      // Kick off background refresh for non-API sources only
      refreshNonApiSources(baseUrl).catch(() => {});
      return NextResponse.json({ events: masterCached, total: masterCached.length, source: "file-cache" });
    }
  }

  // STEP 3: Build from file caches (luma, eventbrite, partiful) + live non-API sources
  const allEvents: FounderEvent[] = [];

  // Read file caches for Luma, Eventbrite, Partiful (no API calls)
  allEvents.push(...loadFileCache("luma"));
  allEvents.push(...loadFileCache("eventbrite"));
  allEvents.push(...loadFileCache("partiful"));

  // Scrape non-API sources (conferences, devevents, etc.)
  const nonApiSources = [
    "conferences", "websearch", "googlesearch", "confstech",
    "f6s", "selectusa", "university", "devevents",
    "garysguide", "tentimes", "startupgrind",
  ];

  const results = await Promise.allSettled(
    nonApiSources.map((s) =>
      fetch(`${baseUrl}/api/${s}`, { signal: AbortSignal.timeout(55_000) })
        .then((r) => r.json())
        .catch(() => ({ events: [] }))
    )
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value?.events) {
      allEvents.push(...r.value.events);
    }
  }

  // Score, dedup, filter
  const processed = processEvents(allEvents);

  // Save to master cache for instant future loads
  saveMasterCache(processed);

  // Upsert to Supabase in background
  upsertToSupabase(processed).catch(() => {});

  return NextResponse.json({ events: processed, total: processed.length, source: "live" });
}

// ---- processing ----

function processEvents(allEvents: FounderEvent[]): FounderEvent[] {
  // Always re-score with latest criteria (O-1A focused)
  for (const e of allEvents) {
    const { score, tier, highLeverage, leverageReason }: LeadScore = scoreLeadQuality(e.title, e.description);
    e.leadScore = score;
    e.leadTier = tier;
    e.highLeverage = highLeverage;
    e.leverageReason = leverageReason;
  }

  // Dedup
  const unique = dedup(allEvents);

  // Filter: next 12 months, score > 0
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() + 1);

  return unique.filter((e) => {
    // Minimum score 35 — only events with clear founder/startup/tech signal
    if ((e.leadScore ?? 0) < 35) return false;
    // Keep dateless events (e.g. Eventbrite/Partiful without dates)
    if (!e.date) return true;
    const d = new Date(e.date);
    if (isNaN(d.getTime())) return true; // keep if unparseable
    if (d < now || d > cutoff) return false;
    return true;
  });
}

function dedup(events: FounderEvent[]): FounderEvent[] {
  const seen = new Map<string, FounderEvent>();
  for (const e of events) {
    const key = `${(e.title ?? "").toLowerCase().trim().slice(0, 60)}-${(e.date ?? "").substring(0, 10)}`;
    const existing = seen.get(key);
    if (!existing || (e.leadScore ?? 0) > (existing.leadScore ?? 0)) {
      seen.set(key, e);
    }
  }
  return Array.from(seen.values());
}

function rowToEvent(row: Record<string, unknown>): FounderEvent {
  return {
    id: row.external_id as string,
    dbId: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? "",
    date: (row.starts_at as string) ?? "",
    endDate: (row.ends_at as string) ?? undefined,
    location: (row.location as string) ?? "",
    url: row.url as string,
    source: remapSource(row.external_id as string, row.source as string),
    category: (row.category as string) ?? "general",
    imageUrl: (row.image_url as string) ?? undefined,
    leadScore: (row.lead_score as number) ?? undefined,
    leadTier: (row.lead_tier as "hot" | "warm" | "cold") ?? "cold",
    highLeverage: (row.high_leverage as boolean) ?? false,
    leverageReason: (row.leverage_reason as string) ?? undefined,
    acceptedAt: (row.accepted_at as string) ?? undefined,
    attendedAt: (row.attended_at as string) ?? undefined,
    organizerName: (row.organizer_name as string) ?? undefined,
    organizerLumaId: (row.organizer_luma_id as string) ?? undefined,
    organizerLinkedin: (row.organizer_linkedin as string) ?? undefined,
    organizerUsername: (row.organizer_username as string) ?? undefined,
  };
}

// ---- background tasks ----

async function refreshNonApiSources(baseUrl: string) {
  const sources = [
    "conferences", "confstech", "devevents", "garysguide", "tentimes", "startupgrind",
  ];
  const results = await Promise.allSettled(
    sources.map((s) =>
      fetch(`${baseUrl}/api/${s}`, { signal: AbortSignal.timeout(55_000) })
        .then((r) => r.json())
        .catch(() => ({ events: [] }))
    )
  );

  const newEvents: FounderEvent[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value?.events) {
      newEvents.push(...r.value.events);
    }
  }

  // Merge with existing master cache
  if (newEvents.length > 0) {
    const existing = loadMasterCache();
    const merged = processEvents([...existing, ...newEvents]);
    saveMasterCache(merged);
    await upsertToSupabase(merged).catch(() => {});
  }
}

async function upsertToSupabase(events: FounderEvent[]) {
  if (events.length === 0) return;

  const rows = events.map((e) => ({
    external_id: e.id,
    source: e.source,
    title: e.title,
    description: e.description?.slice(0, 1000) ?? null,
    location: e.location ?? null,
    url: e.url,
    image_url: e.imageUrl ?? null,
    starts_at: e.date || null,
    ends_at: e.endDate ?? null,
    category: e.category ?? "general",
    lead_tier: e.leadTier ?? "cold",
    lead_score: e.leadScore ?? 0,
    high_leverage: e.highLeverage ?? false,
    leverage_reason: e.leverageReason ?? null,
    last_seen_at: new Date().toISOString(),
    organizer_name: e.organizerName ?? null,
    organizer_luma_id: e.organizerLumaId ?? null,
    organizer_linkedin: e.organizerLinkedin ?? null,
    organizer_username: e.organizerUsername ?? null,
  }));

  // Batch upsert in chunks of 100
  for (let i = 0; i < rows.length; i += 100) {
    await supabase
      .from("scraped_events")
      .upsert(rows.slice(i, i + 100), {
        onConflict: "external_id",
        ignoreDuplicates: false,
      });
  }

  // Upsert organizers
  const organizerMap = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    if (e.organizerLumaId && !organizerMap.has(e.organizerLumaId)) {
      organizerMap.set(e.organizerLumaId, {
        luma_user_id: e.organizerLumaId,
        name: e.organizerName ?? "Unknown",
        username: e.organizerUsername,
        linkedin_handle: e.organizerLinkedin,
        primary_city: extractCity(e.location) || undefined,
        last_seen_at: new Date().toISOString(),
      });
    }
  }

  if (organizerMap.size > 0) {
    await supabase.from("organizers").upsert(
      Array.from(organizerMap.values()),
      { onConflict: "luma_user_id", ignoreDuplicates: false }
    );
  }
}
