import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Read-only JSON feed for the GTM platform's Events calendar.
//
// GTM keeps its own database; nothing is merged. Its backend calls this route
// with a shared bearer token and overlays the result on its calendar, so
// whatever this app scrapes and scores shows up in GTM without either side
// writing to the other. Change what GTM sees by changing this route; bump
// FEED_VERSION when a field is renamed or removed.
//
// GET /api/feed?from=YYYY-MM-DD&to=YYYY-MM-DD&tiers=hot,warm
//   Authorization: Bearer <FEED_TOKEN>

const FEED_VERSION = 1;
const MAX_RANGE_DAYS = 62;
const TIERS = ["hot", "warm", "cold"] as const;
type Tier = (typeof TIERS)[number];

export type FeedEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  url: string | null;
  source: string | null;
  leadTier: Tier;
  leadScore: number | null;
  highLeverage: boolean;
  accepted: boolean;
  attended: boolean;
};

function authorised(request: Request): boolean {
  const expected = process.env.FEED_TOKEN;
  // Fail closed: with no token configured the feed is off, never public.
  if (!expected) return false;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request) {
  if (!process.env.FEED_TOKEN) {
    return NextResponse.json({ error: "Feed disabled: FEED_TOKEN is not set" }, { status: 503 });
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const from = parseDay(params.get("from"));
  const to = parseDay(params.get("to"));
  if (!from || !to || to <= from) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD with to after from" }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    return NextResponse.json({ error: `Range is capped at ${MAX_RANGE_DAYS} days` }, { status: 400 });
  }

  const requested = (params.get("tiers") ?? "hot,warm").split(",").map((t) => t.trim());
  const tiers = new Set<Tier>(TIERS.filter((t) => requested.includes(t)));

  // Supabase caps each request at 1,000 rows; a busy month runs past that.
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < 10; page++) {
    const { data: batch, error } = await supabase
      .from("scraped_events")
      .select("external_id,title,starts_at,ends_at,location,url,source,lead_tier,lead_score,high_leverage,accepted_at,attended_at")
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) {
      console.error("feed query error:", error);
      return NextResponse.json({ error: "Query failed" }, { status: 500 });
    }
    if (!batch || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < 1000) break;
  }

  // The scrapers can land one event under several ids; keep the first per
  // title and day so the GTM calendar does not show duplicates.
  const seen = new Set<string>();
  const events: FeedEvent[] = [];
  for (const row of rows) {
    const tier = ((row.lead_tier as string) ?? "cold") as Tier;
    if (!tiers.has(tier)) continue;
    const startsAt = row.starts_at as string;
    const key = `${String(row.title).trim().toLowerCase()}|${startsAt.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: row.external_id as string,
      title: row.title as string,
      startsAt,
      endsAt: (row.ends_at as string) ?? null,
      location: (row.location as string) ?? null,
      url: (row.url as string) ?? null,
      source: (row.source as string) ?? null,
      leadTier: tier,
      leadScore: (row.lead_score as number) ?? null,
      highLeverage: Boolean(row.high_leverage),
      accepted: Boolean(row.accepted_at),
      attended: Boolean(row.attended_at),
    });
  }

  return NextResponse.json(
    { version: FEED_VERSION, generatedAt: new Date().toISOString(), events },
    { headers: { "Cache-Control": "no-store" } }
  );
}
