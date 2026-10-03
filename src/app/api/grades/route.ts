import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { computeGrade, isGradeInput, summarise, type GradeInput, type GradeRow } from "@/lib/grade";
import { organizerKey, seriesKey } from "@/lib/radar";
import { currentMemberId } from "@/lib/server/feedback";

export const dynamic = "force-dynamic";

// Post-event grades.
//
// GET  /api/grades?event_id=X      every grade for one event, with a summary
// GET  /api/grades?pending_for=ID  past events this person went to and has not graded
// POST /api/grades                 { eventExternalId, teamMemberId?, ...GradeInput }
// DELETE /api/grades?event_id=X    remove your own grade

type DbGrade = {
  id: string;
  event_external_id: string;
  team_member_id: string;
  founder_density: GradeRow["founderDensity"];
  visa_fit: number;
  sellers_heavy: boolean;
  verdict: GradeRow["verdict"];
  notes: string | null;
  score: number;
  updated_at: string | null;
};

function toRow(g: DbGrade, names: Map<string, string>): GradeRow {
  return {
    id: g.id,
    eventExternalId: g.event_external_id,
    teamMemberId: g.team_member_id,
    memberName: names.get(g.team_member_id),
    founderDensity: g.founder_density,
    visaFit: g.visa_fit,
    sellersHeavy: Boolean(g.sellers_heavy),
    verdict: g.verdict,
    notes: g.notes,
    score: g.score,
    updatedAt: g.updated_at ?? undefined,
  };
}

function missingTable(message: string | undefined) {
  return /event_grades|schema cache|does not exist|no such table/i.test(message ?? "");
}

const NOT_SET_UP = { error: "Grading is not set up yet: run supabase/radar-v2.sql", setupNeeded: true };

/** How far back the "to grade" queue looks. */
const PENDING_WINDOW_DAYS = 45;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const eventId = params.get("event_id");
  const pendingFor = params.get("pending_for");

  if (pendingFor) {
    const memberId = await currentMemberId(pendingFor);
    if (!memberId) return NextResponse.json({ events: [] });
    const since = new Date(Date.now() - PENDING_WINDOW_DAYS * 86_400_000).toISOString();
    const now = new Date().toISOString();

    const [{ data: going }, gradesRes] = await Promise.all([
      supabase.from("event_attendance").select("event_external_id").eq("team_member_id", memberId),
      supabase.from("event_grades").select("event_external_id").eq("team_member_id", memberId),
    ]);
    if (gradesRes.error && missingTable(gradesRes.error.message)) return NextResponse.json({ events: [], setupNeeded: true });

    const graded = new Set(((gradesRes.data ?? []) as { event_external_id: string }[]).map((g) => g.event_external_id));
    const ids = ((going ?? []) as { event_external_id: string }[])
      .map((a) => a.event_external_id)
      .filter((id) => !graded.has(id));
    if (ids.length === 0) return NextResponse.json({ events: [] });

    // Only events that have already happened, recently enough to remember.
    const events: Record<string, unknown>[] = [];
    for (const id of ids) {
      const { data } = await supabase
        .from("scraped_events")
        .select("external_id,title,starts_at,location,url")
        .eq("external_id", id)
        .gte("starts_at", since)
        .lt("starts_at", now)
        .limit(1);
      if (data?.[0]) events.push(data[0]);
    }
    return NextResponse.json({
      events: events.map((e) => ({ id: e.external_id, title: e.title, date: e.starts_at, location: e.location, url: e.url })),
    });
  }

  if (!eventId) return NextResponse.json({ error: "event_id or pending_for is required" }, { status: 400 });

  const { data, error } = await supabase.from("event_grades").select("*").eq("event_external_id", eventId);
  if (error) {
    if (missingTable(error.message)) return NextResponse.json({ grades: [], summary: null, setupNeeded: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: members } = await supabase.from("team_members").select("id,name");
  const names = new Map(((members ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const grades = ((data ?? []) as DbGrade[]).map((g) => toRow(g, names));
  return NextResponse.json({ grades, summary: summarise(grades.map((g) => g.score)) });
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw.eventExternalId !== "string" || !isGradeInput(raw)) {
    return NextResponse.json({ error: "Invalid grade" }, { status: 400 });
  }
  const body = raw as GradeInput & { eventExternalId: string; teamMemberId?: string };
  const memberId = await currentMemberId(body.teamMemberId);
  if (!memberId) return NextResponse.json({ error: "Pick who you are first" }, { status: 401 });

  // Keys are taken from the stored event, not the client, so the scorer
  // learns about the series this event really belongs to.
  const { data: ev } = await supabase
    .from("scraped_events")
    .select("title,organizer_name,starts_at,attended_at")
    .eq("external_id", body.eventExternalId)
    .single();
  if (!ev) return NextResponse.json({ error: "Unknown event" }, { status: 404 });
  const event = ev as { title: string; organizer_name: string | null; starts_at: string; attended_at: string | null };
  if (Date.parse(event.starts_at) > Date.now()) {
    return NextResponse.json({ error: "This event has not happened yet" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const row = {
    event_external_id: body.eventExternalId,
    team_member_id: memberId,
    founder_density: body.founderDensity,
    visa_fit: body.visaFit,
    sellers_heavy: body.sellersHeavy,
    verdict: body.verdict,
    notes: body.notes?.trim() || null,
    score: computeGrade(body),
    series_key: seriesKey(event.title) || null,
    organizer_key: organizerKey(event.organizer_name) || null,
    updated_at: now,
  };

  const { error } = await supabase
    .from("event_grades")
    .upsert(row, { onConflict: "event_external_id,team_member_id", ignoreDuplicates: false });
  if (error) {
    if (missingTable(error.message)) return NextResponse.json(NOT_SET_UP, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Grading means you went. Record it so the event counts as attended even if
  // nobody ticked "going" beforehand.
  await supabase
    .from("event_attendance")
    .upsert({ event_external_id: body.eventExternalId, team_member_id: memberId, status: "going" }, {
      onConflict: "event_external_id,team_member_id",
      ignoreDuplicates: true,
    });
  if (!event.attended_at) {
    await supabase.from("scraped_events").update({ attended_at: now }).eq("external_id", body.eventExternalId);
  }

  return NextResponse.json({ ok: true, score: row.score });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const eventId = params.get("event_id");
  const memberId = await currentMemberId(params.get("team_member_id"));
  if (!eventId || !memberId) return NextResponse.json({ error: "event_id and team_member_id are required" }, { status: 400 });
  const { error } = await supabase
    .from("event_grades")
    .delete()
    .eq("event_external_id", eventId)
    .eq("team_member_id", memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
