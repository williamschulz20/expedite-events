import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Event-level attribution: what it cost and how it went.
//
// Kept separate from /api/attend, which only stamps `attended_at`. Spend is
// recorded at the moment money is committed, and the debrief the morning
// after, so they are two different actions by two different people at two
// different times rather than one form nobody fills in.

// POST /api/debrief
//   { dbId, cost?, currency?, debrief_notes?, debriefed_by?, attended? }
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      dbId?: string;
      cost?: number | string | null;
      currency?: string | null;
      debrief_notes?: string | null;
      debriefed_by?: string | null;
      attended?: boolean;
    };

    if (!body.dbId) {
      return NextResponse.json({ error: "dbId required" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    if ("cost" in body) {
      if (body.cost === null || body.cost === "") {
        patch.cost = null;
      } else {
        const amount = Number(body.cost);
        if (!Number.isFinite(amount) || amount < 0) {
          return NextResponse.json({ error: "cost must be a positive number" }, { status: 400 });
        }
        patch.cost = amount;
      }
    }
    if ("currency" in body) patch.currency = body.currency ?? null;

    if ("debrief_notes" in body) {
      patch.debrief_notes = body.debrief_notes?.trim() || null;
      // Stamp who wrote it and when, so a blank debrief is visibly different
      // from one nobody has been asked for yet.
      patch.debriefed_at = patch.debrief_notes ? new Date().toISOString() : null;
      patch.debriefed_by = patch.debrief_notes ? (body.debriefed_by ?? null) : null;
    }

    if ("attended" in body) {
      patch.attended_at = body.attended ? new Date().toISOString() : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const { error } = await supabase.from("scraped_events").update(patch).eq("id", body.dbId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Debrief error:", err);
    return NextResponse.json({ error: "Failed to save debrief" }, { status: 500 });
  }
}
