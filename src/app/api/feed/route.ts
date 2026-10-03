import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { prepareRows } from "@/lib/server/events";

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
      .select("*")
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

  // Same cleaning and scoring as the app: duplicates collapsed, sellers and
  // touring seminars marked down, team grades applied. Upcoming events no
  // scraper has seen recently are left out; past ones are kept.
  const now = Date.now();
  const prepared = await prepareRows(rows, { past: false, includeStale: true });
  const events: FeedEvent[] = prepared
    .filter((e) => !(e.stale && Date.parse(e.date) > now))
    .filter((e) => tiers.has((e.leadTier ?? "cold") as Tier))
    .map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.date,
      endsAt: e.endDate ?? null,
      location: e.location || null,
      url: e.url || null,
      source: e.source || null,
      leadTier: (e.leadTier ?? "cold") as Tier,
      leadScore: e.leadScore ?? null,
      highLeverage: Boolean(e.highLeverage),
      accepted: Boolean(e.acceptedAt),
      attended: Boolean(e.attendedAt),
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return NextResponse.json(
    { version: FEED_VERSION, generatedAt: new Date().toISOString(), events },
    { headers: { "Cache-Control": "no-store" } }
  );
}
