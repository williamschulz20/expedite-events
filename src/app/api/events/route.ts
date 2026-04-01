import { NextResponse } from "next/server";
import { FounderEvent, scoreLeadQuality, LeadScore } from "@/lib/types";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Remap source from external_id prefix for old cached data tagged as "luma"
function remapSource(externalId: string, dbSource: string): string {
  if (dbSource !== "luma") return dbSource;
  // Detect real source from ID prefix
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
  // Conference IDs are like "latitude59-2026", "slush-2026", etc.
  const confIds = ["latitude59", "slush", "web-summit", "tnw", "noah", "viva", "collision", "techcrunch", "rise-conf", "wolves", "arctic15", "login-", "riga-comm", "oslo-innovation", "sifted", "london-tech-week", "bits-pretzels", "pirate-summit", "pioneers", "south-summit", "websummit", "startup-grind", "tech-open-air", "tallinn-digital"];
  if (confIds.some((c) => externalId.startsWith(c))) return "conference";
  return "luma"; // genuinely from Luma
}

// Extract city name from location string
function extractCity(location: string): string {
  if (!location) return "";
  const loc = location.toLowerCase();
  const KNOWN_CITIES = [
    "London", "Berlin", "Paris", "Amsterdam", "San Francisco",
    "Munich", "Barcelona", "Zurich", "Stockholm", "Helsinki",
    "Lisbon", "Dublin", "Copenhagen", "Milan", "Madrid",
    "Istanbul", "Vienna", "Warsaw", "Brussels", "Hamburg",
    "Budapest", "Prague", "Geneva", "Lausanne", "Rome",
    "Los Angeles",
  ];
  if (loc.includes("san francisco") || loc.includes(", ca ") || loc.includes("sf,")) return "San Francisco";
  for (const city of KNOWN_CITIES) {
    if (loc.includes(city.toLowerCase())) return city;
  }
  return "";
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin;

  // Always return from Supabase first (includes accept/attend state)
  // then refresh in background from scrapers
  const { data: cached } = await supabase
    .from("scraped_events")
    .select("*")
    .gte("starts_at", new Date().toISOString())
    .lte("starts_at", new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true });

  // Kick off a background scrape + upsert (non-blocking)
  scrapeAndUpsert(baseUrl).catch(() => {});

  if (cached && cached.length > 0) {
    // Dedup cross-source: same title on same day → keep the one with higher lead_score
    const dedupMap = new Map<string, typeof cached[0]>();
    for (const row of cached) {
      const key = `${(row.title ?? "").toLowerCase().trim().slice(0, 60)}-${(row.starts_at ?? "").substring(0, 10)}`;
      const existing = dedupMap.get(key);
      if (!existing || (row.lead_score ?? 0) > (existing.lead_score ?? 0)) {
        dedupMap.set(key, row);
      }
    }
    const deduped = Array.from(dedupMap.values());

    // Shape Supabase rows into FounderEvent format for the UI
    const events = deduped.map((row) => ({
      id: row.external_id,
      dbId: row.id,
      title: row.title,
      description: row.description ?? "",
      date: row.starts_at ?? "",
      endDate: row.ends_at ?? undefined,
      location: row.location ?? "",
      url: row.url,
      source: remapSource(row.external_id, row.source),
      category: row.category ?? "general",
      imageUrl: row.image_url ?? undefined,
      leadScore: row.lead_score ?? undefined,
      leadTier: row.lead_tier ?? "cold",
      highLeverage: row.high_leverage ?? false,
      leverageReason: row.leverage_reason ?? undefined,
      acceptedAt: row.accepted_at ?? undefined,
      attendedAt: row.attended_at ?? undefined,
      organizerName: row.organizer_name ?? undefined,
      organizerLumaId: row.organizer_luma_id ?? undefined,
      organizerLinkedin: row.organizer_linkedin ?? undefined,
      organizerUsername: row.organizer_username ?? undefined,
    }));

    return NextResponse.json({ events, total: events.length, source: "supabase", deduped: cached.length - deduped.length });
  }

  // No cache yet — do a live scrape and return
  const fresh = await scrapeAndUpsert(baseUrl);
  return NextResponse.json({ events: fresh, total: fresh.length, source: "live" });
}

async function scrapeAndUpsert(baseUrl: string) {
  try {
    const sources = [
      "eventbrite", "luma", "partiful", "conferences", "websearch",
      "googlesearch", "confstech", "f6s", "selectusa", "university",
      "devevents", "garysguide", "tentimes", "startupgrind",
    ];
    const results = await Promise.allSettled(
      sources.map((s) =>
        fetch(`${baseUrl}/api/${s}`, { signal: AbortSignal.timeout(55_000) })
          .then((r) => r.json())
          .catch(() => ({ events: [] }))
      )
    );

    const allEvents: FounderEvent[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value?.events) {
        allEvents.push(...r.value.events);
      }
    }

    // Dedup
    const seen = new Set<string>();
    const unique = allEvents.filter((e) => {
      const key = `${e.title.toLowerCase().trim()}-${e.date.substring(0, 10)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Score
    for (const e of unique) {
      const { score, tier, highLeverage, leverageReason }: LeadScore = scoreLeadQuality(e.title, e.description);
      e.leadScore = score;
      e.leadTier = tier;
      e.highLeverage = highLeverage;
      e.leverageReason = leverageReason;
    }

    // Filter: next 12 months
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() + 1);
    const future = unique.filter((e) => {
      if (!e.date) return false;
      const d = new Date(e.date);
      if (d < now || d > cutoff) return false;
      return (e.leadScore ?? 0) > 0;
    });

    // Upsert into Supabase
    if (future.length > 0) {
      const rows = future.map((e) => ({
        external_id:      e.id,
        source:           e.source,
        title:            e.title,
        description:      e.description?.slice(0, 1000) ?? null,
        location:         e.location ?? null,
        url:              e.url,
        image_url:        e.imageUrl ?? null,
        starts_at:        e.date || null,
        ends_at:          e.endDate ?? null,
        category:         e.category ?? "general",
        lead_tier:        e.leadTier ?? "cold",
        lead_score:       e.leadScore ?? 0,
        high_leverage:    e.highLeverage ?? false,
        leverage_reason:  e.leverageReason ?? null,
        last_seen_at:     new Date().toISOString(),
        organizer_name:   e.organizerName ?? null,
        organizer_luma_id: e.organizerLumaId ?? null,
        organizer_linkedin: e.organizerLinkedin ?? null,
        organizer_username: e.organizerUsername ?? null,
      }));

      await supabase
        .from("scraped_events")
        .upsert(rows, {
          onConflict: "external_id",
          ignoreDuplicates: false,
        });
    }

    // Upsert unique organizers
    const organizerMap = new Map<string, {
      luma_user_id: string;
      name: string;
      username?: string;
      linkedin_handle?: string;
      avatar_url?: string;
      website?: string;
      primary_city?: string;
      last_seen_at: string;
    }>();

    for (const e of future) {
      if (e.organizerLumaId && !organizerMap.has(e.organizerLumaId)) {
        organizerMap.set(e.organizerLumaId, {
          luma_user_id: e.organizerLumaId,
          name: e.organizerName ?? "Unknown",
          username: e.organizerUsername,
          linkedin_handle: e.organizerLinkedin,
          avatar_url: e.organizerAvatarUrl,
          website: e.organizerWebsite,
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

    return future.map((e) => ({
      id:             e.id,
      title:          e.title,
      description:    e.description ?? "",
      date:           e.date,
      endDate:        e.endDate,
      location:       e.location ?? "",
      url:            e.url,
      source:         e.source,
      category:       e.category ?? "general",
      imageUrl:       e.imageUrl,
      leadScore:      e.leadScore,
      leadTier:       e.leadTier ?? "cold",
      highLeverage:   e.highLeverage ?? false,
      leverageReason: e.leverageReason ?? undefined,
      organizerName:  e.organizerName,
      organizerLumaId: e.organizerLumaId,
      organizerLinkedin: e.organizerLinkedin,
      organizerUsername: e.organizerUsername,
    }));
  } catch {
    return [];
  }
}
