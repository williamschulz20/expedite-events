// Post-event grading: four quick answers turned into one 0-100 score.
//
// The questions are the ones that predict whether going was worth it for
// Expedite, in the order someone remembers them walking out of the room. The
// score is what flows back into the scorer (src/lib/radar.ts), so the weights
// favour visa-fit people over a generally good vibe.

export const DENSITIES = ["none", "few", "some", "lots"] as const;
export type FounderDensity = (typeof DENSITIES)[number];

export const VERDICTS = ["again", "maybe", "skip"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface GradeInput {
  founderDensity: FounderDensity;
  /** People who looked like O-1A candidates. */
  visaFit: number;
  sellersHeavy: boolean;
  verdict: Verdict;
  notes?: string | null;
}

export interface GradeRow extends GradeInput {
  id: string;
  eventExternalId: string;
  teamMemberId: string;
  memberName?: string;
  score: number;
  updatedAt?: string;
}

export const DENSITY_LABELS: Record<FounderDensity, string> = {
  none: "None",
  few: "A few",
  some: "Plenty",
  lots: "Mostly founders",
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  again: "Go again",
  maybe: "Maybe",
  skip: "Skip next time",
};

const DENSITY_POINTS: Record<FounderDensity, number> = { none: 0, few: 30, some: 65, lots: 100 };
const VERDICT_POINTS: Record<Verdict, number> = { again: 100, maybe: 50, skip: 0 };

function visaFitPoints(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 50;
  if (n === 2) return 70;
  if (n <= 4) return 85;
  return 100;
}

export function computeGrade(input: GradeInput): number {
  const raw =
    0.35 * visaFitPoints(input.visaFit) +
    0.35 * DENSITY_POINTS[input.founderDensity] +
    0.3 * VERDICT_POINTS[input.verdict] -
    (input.sellersHeavy ? 15 : 0);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export function letterFor(score: number): string {
  return score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";
}

export const LETTER_STYLES: Record<string, string> = {
  A: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  B: "bg-lime-50 text-lime-700 ring-lime-200",
  C: "bg-amber-50 text-amber-700 ring-amber-200",
  D: "bg-orange-50 text-orange-700 ring-orange-200",
  F: "bg-red-50 text-red-700 ring-red-200",
};

export interface GradeSummary {
  score: number;
  letter: string;
  count: number;
}

export function summarise(scores: number[]): GradeSummary | null {
  if (scores.length === 0) return null;
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { score, letter: letterFor(score), count: scores.length };
}

export function isGradeInput(body: unknown): body is GradeInput {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    DENSITIES.includes(b.founderDensity as FounderDensity) &&
    VERDICTS.includes(b.verdict as Verdict) &&
    typeof b.visaFit === "number" &&
    Number.isInteger(b.visaFit) &&
    b.visaFit >= 0 &&
    b.visaFit <= 500 &&
    typeof b.sellersHeavy === "boolean" &&
    (b.notes === undefined || b.notes === null || typeof b.notes === "string")
  );
}
