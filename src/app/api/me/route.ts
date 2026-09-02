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

  // Sign-in is allowlisted against team_members, so a signed-in user with no
  // row means the row was deleted mid-session. Treat as not authorized.
  return NextResponse.json({ error: "Not on the team list" }, { status: 403 });
}