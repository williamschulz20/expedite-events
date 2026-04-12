import { NextResponse } from "next/server";
import { FounderEvent } from "@/lib/types";
import {
  computeWeeklySummary,
  computeSourcePerformance,
  weekOverWeekDelta,
} from "@/lib/analytics";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const MASTER_CACHE = path.join(process.cwd(), "events-cache.json");

function loadEvents(): FounderEvent[] {
  try {
    if (fs.existsSync(MASTER_CACHE)) {
      return JSON.parse(fs.readFileSync(MASTER_CACHE, "utf-8"));
    }
  } catch {}
  return [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "weekly";

  const events = loadEvents();

  if (view === "sources") {
    const performance = computeSourcePerformance(events);
    return NextResponse.json({ sources: performance });
  }

  // Default: weekly summary with week-over-week comparison
  const now = new Date();
  const currentWeek = computeWeeklySummary(events, now);

  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const previousWeek = computeWeeklySummary(events, lastWeek);

  const delta = weekOverWeekDelta(currentWeek, previousWeek);

  return NextResponse.json({
    current: currentWeek,
    previous: previousWeek,
    weekOverWeek: delta,
  });
}
