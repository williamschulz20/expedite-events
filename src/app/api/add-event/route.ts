import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { scoreLeadQuality, categorizeEvent } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      title: string;
      date: string;
      location: string;
      url?: string;
      description?: string;
      category?: string;
      source?: string;
    };

    const { title, date, location, url = "", description = "", category, source = "manual" } = body;

    if (!title || !date || !location) {
      return NextResponse.json({ error: "title, date, and location are required" }, { status: 400 });
    }

    const scored = scoreLeadQuality(title, description);
    const resolvedCategory = category || categorizeEvent(title, description);
    const externalId = `manual-${Date.now()}`;
    const now = new Date().toISOString();

    // Normalize date to ISO string
    const startsAt = date.includes("T") ? date : `${date}T09:00:00Z`;

    const row = {
      external_id: externalId,
      source,
      title,
      description: description || null,
      location,
      url: url || null,
      image_url: null,
      starts_at: startsAt,
      ends_at: null,
      category: resolvedCategory,
      lead_score: scored.score,
      lead_tier: scored.tier,
      high_leverage: scored.highLeverage,
      leverage_reason: scored.leverageReason || null,
      rsvp_status: "pending",
      first_seen_at: now,
      last_seen_at: now,
      accepted_at: null,
      attended_at: null,
    };

    const { data, error } = await supabase
      .from("scraped_events")
      .upsert(row, { onConflict: "external_id" })
      .select()
      .single();

    if (error) {
      console.error("add-event upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return the event in FounderEvent shape for the UI
    const event = {
      id: externalId,
      dbId: data?.id,
      title,
      description,
      date: startsAt,
      location,
      url,
      source,
      category: resolvedCategory,
      leadScore: scored.score,
      leadTier: scored.tier,
      highLeverage: scored.highLeverage,
      leverageReason: scored.leverageReason,
    };

    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    console.error("add-event error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
