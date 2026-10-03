import { auth } from "@/auth";
import { supabase } from "@/lib/supabase";
import { summarise, type GradeSummary } from "@/lib/grade";
import { EMPTY_FEEDBACK, type Feedback, type GradeSignal } from "@/lib/radar";

// Server-only reads behind the grading loop. Every read here tolerates the
// tables not existing yet (supabase/radar-v2.sql not applied): grading is an
// addition, and the events list must keep working without it.

type GradeRecord = {
  event_external_id: string;
  score: number;
  series_key: string | null;
  organizer_key: string | null;
};

async function loadGradeRows(): Promise<GradeRecord[]> {
  try {
    const { data, error } = await supabase
      .from("event_grades")
      .select("event_external_id,score,series_key,organizer_key");
    if (error) return [];
    return (data ?? []) as GradeRecord[];
  } catch {
    return [];
  }
}

function signals(rows: GradeRecord[], key: (r: GradeRecord) => string | null): Map<string, GradeSignal> {
  const scores = new Map<string, number[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    scores.set(k, [...(scores.get(k) ?? []), r.score]);
  }
  const out = new Map<string, GradeSignal>();
  for (const [k, list] of scores) {
    const s = summarise(list);
    if (s) out.set(k, { score: s.score, count: s.count });
  }
  return out;
}

/** Grades in the shapes the events list needs: feedback for scoring, summaries per event. */
export async function loadGrades(): Promise<{ feedback: Feedback; byEvent: Record<string, GradeSummary> }> {
  const rows = await loadGradeRows();
  if (rows.length === 0) return { feedback: EMPTY_FEEDBACK, byEvent: {} };
  const byEventScores = new Map<string, number[]>();
  for (const r of rows) byEventScores.set(r.event_external_id, [...(byEventScores.get(r.event_external_id) ?? []), r.score]);
  const byEvent: Record<string, GradeSummary> = {};
  for (const [id, list] of byEventScores) {
    const s = summarise(list);
    if (s) byEvent[id] = s;
  }
  // An event's own grade also feeds its series signal. That only shows on
  // events already graded, which are in the past and display their grade
  // letter instead, so it never misleads a decision about going.
  return {
    feedback: {
      bySeries: signals(rows, (r) => r.series_key),
      byOrganizer: signals(rows, (r) => r.organizer_key),
    },
    byEvent,
  };
}

/**
 * The team member making a request. With Google sign-in configured the
 * session decides, so nobody can grade as someone else; without it (local
 * runs) the client's own pick is trusted, as the rest of the app does.
 */
export async function currentMemberId(claimed: string | null | undefined): Promise<string | null> {
  try {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase();
    if (email) {
      const { data } = await supabase.from("team_members").select("id").eq("email", email).single();
      return (data as { id: string } | null)?.id ?? null;
    }
  } catch {
    // Auth not configured: fall through to the claimed id.
  }
  return claimed ?? null;
}
