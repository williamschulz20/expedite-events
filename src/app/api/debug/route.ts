import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Debug endpoint — shows pipeline coverage at a glance.
 * Hit /api/debug to audit what the scraper is actually finding.
 */
export async function GET() {
  // Overall counts by source + tier
  const { data: bySourceTier } = await supabase
    .from("scraped_events")
    .select("source, lead_tier, lead_score, starts_at")
    .gte("starts_at", new Date().toISOString());

  if (!bySourceTier) {
    return NextResponse.json({ error: "No data" }, { status: 500 });
  }

  // Group by source
  const sources: Record<string, {
    total: number;
    hot: number;
    warm: number;
    cold: number;
    unscored: number;
    earliest: string;
    latest: string;
  }> = {};

  for (const row of bySourceTier) {
    const src = row.source ?? "unknown";
    if (!sources[src]) {
      sources[src] = { total: 0, hot: 0, warm: 0, cold: 0, unscored: 0, earliest: "", latest: "" };
    }
    const s = sources[src];
    s.total++;
    if (row.lead_tier === "hot")  s.hot++;
    else if (row.lead_tier === "warm") s.warm++;
    else if (row.lead_tier === "cold") s.cold++;
    else s.unscored++;

    const date = row.starts_at ?? "";
    if (!s.earliest || date < s.earliest) s.earliest = date.substring(0, 10);
    if (!s.latest || date > s.latest)     s.latest   = date.substring(0, 10);
  }

  // Score band distribution
  const bands: Record<string, number> = {
    "80-100 (hot)": 0,
    "70-79 (strong warm)": 0,
    "55-69 (warm)": 0,
    "40-54 (borderline)": 0,
    "1-39 (cold)": 0,
    "0 (no signal)": 0,
  };
  for (const row of bySourceTier) {
    const s = row.lead_score ?? 0;
    if (s >= 80)      bands["80-100 (hot)"]++;
    else if (s >= 70) bands["70-79 (strong warm)"]++;
    else if (s >= 55) bands["55-69 (warm)"]++;
    else if (s >= 40) bands["40-54 (borderline)"]++;
    else if (s > 0)   bands["1-39 (cold)"]++;
    else              bands["0 (no signal)"]++;
  }

  // Monthly distribution
  const monthly: Record<string, number> = {};
  for (const row of bySourceTier) {
    const month = (row.starts_at ?? "").substring(0, 7);
    if (month) monthly[month] = (monthly[month] ?? 0) + 1;
  }

  // Recent scrape timestamps
  const { data: recentScrapes } = await supabase
    .from("scraped_events")
    .select("source, last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    total_upcoming: bySourceTier.length,
    by_source: sources,
    score_distribution: bands,
    monthly_distribution: Object.fromEntries(
      Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b))
    ),
    recent_scrapes: recentScrapes,
    generated_at: new Date().toISOString(),
  });
}
