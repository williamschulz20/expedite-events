import type { ScoreAdjustment } from "@/lib/radar";

// Why an event scored what it did: the listing's own score and reason, then
// every adjustment layered on top. Shown on every event, not only hot ones,
// because "why is this only warm?" is the question people actually ask.
export function ScoreBreakdown({
  score,
  baseScore,
  reason,
  adjustments,
}: {
  score: number;
  baseScore?: number;
  reason?: string;
  adjustments?: ScoreAdjustment[];
}) {
  const base = baseScore ?? score;
  return (
    <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Why this score</p>
        <p className="text-sm font-bold tabular-nums text-gray-900">
          {score}
          <span className="text-[11px] font-normal text-gray-400">/100</span>
        </p>
      </div>
      <ul className="space-y-0.5 text-xs">
        <li className="flex justify-between gap-3 text-gray-700">
          <span>{reason || "General founder or tech signal in the listing"}</span>
          <span className="shrink-0 tabular-nums text-gray-400">{base}</span>
        </li>
        {(adjustments ?? []).map((a) => (
          <li key={a.reason} className={`flex justify-between gap-3 ${a.delta < 0 ? "text-red-700" : "text-emerald-700"}`}>
            <span>{a.reason}</span>
            <span className="shrink-0 tabular-nums">
              {a.delta > 0 ? "+" : ""}
              {a.delta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
