import { NextResponse } from "next/server";
import { scoreLeadQuality } from "@/lib/types";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest — Bulk ingest events from browser scraping.
 * Accepts JSON body: { events: Array<{ id, title, description, date, endDate, location, url, source, imageUrl, organizerName, organizerLumaId, organizerUsername, organizerLinkedin }> }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const events: Array<{
      id: string;
      title: string;
      description?: string;
      date: string;
      endDate?: string;
      location?: string;
      url: string;
      source?: string;
      category?: string;
      imageUrl?: string;
      organizerName?: string;
      organizerLumaId?: string;
      organizerUsername?: string;
      organizerLinkedin?: string;
    }> = body.events ?? [];

    if (events.length === 0) {
      return NextResponse.json({ error: "No events provided" }, { status: 400 });
    }

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() + 1);

    // Score and filter
    const rows = [];
    for (const e of events) {
      if (!e.title || !e.date || !e.id) continue;
      const d = new Date(e.date);
      if (d < now || d > cutoff) continue;

      const { score, tier, highLeverage, leverageReason } = scoreLeadQuality(
        e.title,
        e.description ?? ""
      );

      if (score <= 0) continue;

      rows.push({
        external_id: e.id,
        source: e.source ?? "luma",
        title: e.title,
        description: (e.description ?? "").slice(0, 1000) || null,
        location: e.location ?? null,
        url: e.url,
        image_url: e.imageUrl ?? null,
        starts_at: e.date,
        ends_at: e.endDate ?? null,
        category: e.category ?? "general",
        lead_tier: tier,
        lead_score: score,
        high_leverage: highLeverage,
        leverage_reason: leverageReason || null,
        last_seen_at: now.toISOString(),
        organizer_name: e.organizerName ?? null,
        organizer_luma_id: e.organizerLumaId ?? null,
        organizer_linkedin: e.organizerLinkedin ?? null,
        organizer_username: e.organizerUsername ?? null,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ upserted: 0, filtered: events.length });
    }

    const { error } = await supabase
      .from("scraped_events")
      .upsert(rows, { onConflict: "external_id", ignoreDuplicates: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      upserted: rows.length,
      filtered: events.length - rows.length,
      total_received: events.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
