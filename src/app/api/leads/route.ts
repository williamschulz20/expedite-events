import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// The people we actually spoke to at an event. Distinct from the attendee list
// (who was in the room) and from team attendance (who of ours went).

const QUALITIES = new Set(["hot", "warm", "cold"]);

const SELECT = `
  id,
  event_external_id,
  name,
  title,
  company,
  linkedin_url,
  email,
  lead_quality,
  notes,
  captured_by,
  captured_at,
  gtm_person_id,
  gtm_deal_id,
  gtm_deal_name,
  gtm_deal_stage,
  gtm_deal_amount,
  gtm_deal_currency
`;

// GET /api/leads                  -> every lead, grouped by event
// GET /api/leads?event_id=<extid> -> the leads for one event, flat
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("event_id");

  try {
    let query = supabase.from("captured_leads").select(SELECT);
    if (eventId) query = query.eq("event_external_id", eventId);

    const { data, error } = await query.order("captured_at", { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    if (eventId) return NextResponse.json({ leads: rows });

    // The list and calendar views need a count and a rated/unrated split per
    // event without fetching each event's leads separately.
    const leadsByEvent: Record<string, Array<Record<string, unknown>>> = {};
    for (const row of rows) {
      const key = String(row.event_external_id);
      (leadsByEvent[key] ??= []).push(row);
    }
    return NextResponse.json({ leadsByEvent });
  } catch (err) {
    console.error("Leads GET error:", err);
    return NextResponse.json({ leadsByEvent: {}, leads: [] }, { status: 500 });
  }
}

// POST /api/leads: capture a person met at an event.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      event_external_id?: string;
      name?: string;
      title?: string | null;
      company?: string | null;
      linkedin_url?: string | null;
      email?: string | null;
      lead_quality?: string | null;
      notes?: string | null;
      captured_by?: string | null;
    };

    if (!body.event_external_id || !body.name?.trim()) {
      return NextResponse.json(
        { error: "event_external_id and name are required" },
        { status: 400 }
      );
    }
    if (body.lead_quality && !QUALITIES.has(body.lead_quality)) {
      return NextResponse.json({ error: "lead_quality must be hot, warm or cold" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("captured_leads")
      .insert({
        event_external_id: body.event_external_id,
        name: body.name.trim(),
        title: body.title?.trim() || null,
        company: body.company?.trim() || null,
        linkedin_url: body.linkedin_url?.trim() || null,
        email: body.email?.trim() || null,
        lead_quality: body.lead_quality ?? null,
        notes: body.notes?.trim() || null,
        captured_by: body.captured_by ?? null,
        // Set here rather than leaning on the column default: the local SQLite
        // store does not apply Postgres defaults, and ordering by this column
        // would be unstable if half the rows came back null.
        captured_at: new Date().toISOString(),
      })
      .select(SELECT)
      .single();

    if (error) throw error;
    return NextResponse.json({ lead: data });
  } catch (err) {
    console.error("Leads POST error:", err);
    return NextResponse.json({ error: "Failed to capture lead" }, { status: 500 });
  }
}

// PATCH /api/leads: update one lead. The rating is the common case, so the
// body is a sparse patch rather than a whole row.
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      lead_quality?: string | null;
      notes?: string | null;
      title?: string | null;
      company?: string | null;
      linkedin_url?: string | null;
      email?: string | null;
      gtm_person_id?: string | null;
      gtm_deal_id?: string | null;
      gtm_deal_name?: string | null;
      gtm_deal_stage?: string | null;
      gtm_deal_amount?: number | null;
      gtm_deal_currency?: string | null;
    };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (body.lead_quality && !QUALITIES.has(body.lead_quality)) {
      return NextResponse.json({ error: "lead_quality must be hot, warm or cold" }, { status: 400 });
    }

    // Only the keys actually present are written, so clearing a rating (null)
    // stays distinguishable from leaving it alone (absent).
    const patch: Record<string, unknown> = {};
    const fields = [
      "lead_quality",
      "notes",
      "title",
      "company",
      "linkedin_url",
      "email",
      "gtm_person_id",
      "gtm_deal_id",
      "gtm_deal_name",
      "gtm_deal_stage",
      "gtm_deal_amount",
      "gtm_deal_currency",
    ] as const;
    for (const field of fields) {
      if (field in body) patch[field] = body[field] ?? null;
    }
    if ("gtm_deal_id" in body) patch.gtm_synced_at = new Date().toISOString();

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("captured_leads")
      .update(patch)
      .eq("id", body.id)
      .select(SELECT)
      .single();

    if (error) throw error;
    return NextResponse.json({ lead: data });
  } catch (err) {
    console.error("Leads PATCH error:", err);
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
}

// DELETE /api/leads: remove a mis-captured lead.
export async function DELETE(request: Request) {
  try {
    const { id } = (await request.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { error } = await supabase.from("captured_leads").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Leads DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete lead" }, { status: 500 });
  }
}
