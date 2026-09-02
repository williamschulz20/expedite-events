import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/me — the signed-in Google user, mapped onto a team_members row.
// Matches on email; creates the row on first sign-in so a new colleague can
// use the app without anyone touching the database.
export async function GET() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!session?.user || !email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const user = session.user;

  const { data: existing } = await supabase
    .from("team_members")
    .select("*")
    .eq("email", email)
    .single();

  if (existing) {
    return NextResponse.json({ member: existing, user });
  }

  const name = user.name || email.split("@")[0];
  const initials = name
    .split(/\s+/)
    .map((p: string) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Stable id derived from the email local part, so re-signing in reuses the row.
  const id = `tm-${email.split("@")[0].replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  const palette = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#0ea5e9"];
  const color = palette[id.length % palette.length];

  const { data: created, error } = await supabase
    .from("team_members")
    .upsert(
      { id, name, email, initials, avatar_color: color, calendar_setup_done: false },
      { onConflict: "id", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: created, user });
}
