import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Scraper health, one row per source per run (supabase/radar-v2.sql).
//
// POST is called by scripts/scrape-all.mjs. GET summarises the latest outcome
// and the last success per source, which the app shows so a dead feed is
// visible to the people relying on it.

type Run = {
  source: string;
  ok: boolean;
  scraped: number;
  saved: number;
  error: string | null;
  finished_at: string;
};

export type SourceHealth = {
  source: string;
  ok: boolean;
  lastRunAt: string;
  lastSuccessAt: string | null;
  scraped: number;
  error: string | null;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.source !== "string" || typeof body.runId !== "string") {
    return NextResponse.json({ error: "runId and source are required" }, { status: 400 });
  }
  const { error } = await supabase.from("source_runs").insert({
    run_id: body.runId,
    source: body.source,
    ok: Boolean(body.ok),
    scraped: Number(body.scraped) || 0,
    saved: Number(body.saved) || 0,
    error: typeof body.error === "string" ? body.error.slice(0, 500) : null,
    duration_ms: Number(body.durationMs) || null,
    finished_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("source_runs")
    .select("source,ok,scraped,saved,error,finished_at")
    .gte("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(1000);
  // Table not created yet: report nothing rather than an error banner.
  if (error) return NextResponse.json({ sources: [] });

  const bySource = new Map<string, SourceHealth>();
  for (const run of (data ?? []) as Run[]) {
    const current = bySource.get(run.source);
    if (!current) {
      bySource.set(run.source, {
        source: run.source,
        ok: Boolean(run.ok),
        lastRunAt: run.finished_at,
        lastSuccessAt: run.ok ? run.finished_at : null,
        scraped: run.scraped,
        error: run.error,
      });
    } else if (!current.lastSuccessAt && run.ok) {
      current.lastSuccessAt = run.finished_at;
    }
  }
  return NextResponse.json({ sources: [...bySource.values()] });
}
