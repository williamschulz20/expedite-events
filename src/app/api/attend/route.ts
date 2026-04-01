import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/attend  { dbId: string }
// Marks the event as attended in Supabase.
export async function POST(request: Request) {
  try {
    const { dbId } = await request.json() as { dbId: string };
    if (!dbId) return NextResponse.json({ error: "dbId required" }, { status: 400 });

    const { error } = await supabase
      .schema("event_scraper")
      .from("scraped_events")
      .update({ attended_at: new Date().toISOString() })
      .eq("id", dbId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Attend error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
