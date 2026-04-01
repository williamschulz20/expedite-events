import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("team_members")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ members: data ?? [] });
  } catch (err) {
    console.error("Team route error:", err);
    return NextResponse.json({ members: [] }, { status: 500 });
  }
}
