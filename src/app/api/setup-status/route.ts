import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Which optional schema is in place. Lead capture and spend need
// supabase/attribution.sql; grading and source health need
// supabase/radar-v2.sql. The UI hides those panels until their tables exist,
// so a deploy ahead of the SQL shows a note instead of red errors.

async function tableReady(table: string, column = "id"): Promise<boolean> {
  try {
    const { error } = await supabase.from(table).select(column).limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function GET() {
  const [leads, cost, grades, runs] = await Promise.all([
    tableReady("captured_leads"),
    tableReady("scraped_events", "cost"),
    tableReady("event_grades"),
    tableReady("source_runs"),
  ]);
  return NextResponse.json({ attribution: leads && cost, grading: grades && runs });
}
