import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/attendance — returns all attendance grouped by event_external_id
// GET /api/attendance?event_id=xxx — returns attendance for one event
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("event_id");

  try {
    let query = supabase
      .from("event_attendance")
      .select(`
        id,
        event_external_id,
        status,
        created_at,
        team_members (
          id,
          name,
          initials,
          avatar_color
        )
      `);

    if (eventId) {
      query = query.eq("event_external_id", eventId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Shape the response
    type AttendanceRow = {
      id: string;
      event_external_id: string;
      status: string;
      created_at: string;
      team_members: {
        id: string;
        name: string;
        initials: string;
        avatar_color: string;
      } | null;
    };

    const rows = (data ?? []) as unknown as AttendanceRow[];

    if (eventId) {
      // Single event: return flat array
      const attendees = rows
        .filter((r) => r.team_members)
        .map((r) => ({
          attendanceId: r.id,
          memberId: r.team_members!.id,
          memberName: r.team_members!.name,
          initials: r.team_members!.initials,
          avatarColor: r.team_members!.avatar_color,
          status: r.status,
        }));
      return NextResponse.json({ attendees });
    }

    // All events: group by event_external_id
    const attendanceByEvent: Record<string, Array<{
      attendanceId: string;
      memberId: string;
      memberName: string;
      initials: string;
      avatarColor: string;
      status: string;
    }>> = {};

    for (const row of rows) {
      if (!row.team_members) continue;
      const key = row.event_external_id;
      if (!attendanceByEvent[key]) attendanceByEvent[key] = [];
      attendanceByEvent[key].push({
        attendanceId: row.id,
        memberId: row.team_members.id,
        memberName: row.team_members.name,
        initials: row.team_members.initials,
        avatarColor: row.team_members.avatar_color,
        status: row.status,
      });
    }

    return NextResponse.json({ attendanceByEvent });
  } catch (err) {
    console.error("Attendance GET error:", err);
    return NextResponse.json({ attendanceByEvent: {}, attendees: [] }, { status: 500 });
  }
}

// POST /api/attendance — upsert attendance record
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      event_external_id: string;
      team_member_id: string;
      status?: "going" | "maybe";
    };

    const { event_external_id, team_member_id, status = "going" } = body;

    if (!event_external_id || !team_member_id) {
      return NextResponse.json({ error: "event_external_id and team_member_id are required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("event_attendance")
      .upsert(
        { event_external_id, team_member_id, status },
        { onConflict: "event_external_id,team_member_id", ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ attendance: data });
  } catch (err) {
    console.error("Attendance POST error:", err);
    return NextResponse.json({ error: "Failed to upsert attendance" }, { status: 500 });
  }
}

// DELETE /api/attendance — remove attendance record
export async function DELETE(request: Request) {
  try {
    const body = await request.json() as {
      event_external_id: string;
      team_member_id: string;
    };

    const { event_external_id, team_member_id } = body;

    if (!event_external_id || !team_member_id) {
      return NextResponse.json({ error: "event_external_id and team_member_id are required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("event_attendance")
      .delete()
      .eq("event_external_id", event_external_id)
      .eq("team_member_id", team_member_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Attendance DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete attendance" }, { status: 500 });
  }
}
