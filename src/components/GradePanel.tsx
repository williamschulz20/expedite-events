"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DENSITIES,
  DENSITY_LABELS,
  LETTER_STYLES,
  VERDICTS,
  VERDICT_LABELS,
  computeGrade,
  letterFor,
  type FounderDensity,
  type GradeRow,
  type GradeSummary,
  type Verdict,
} from "@/lib/grade";

// "How was it?" for an event someone went to. Four taps and an optional note,
// answered walking out of the room. The grade it produces moves the score of
// the next edition of the same series (src/lib/radar.ts), which is how the
// radar learns which listings are worth the evening.

function Segmented<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
            value === o ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-500 ring-gray-200 hover:text-gray-800"
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

export function GradeBadge({ summary, size = "sm" }: { summary: GradeSummary; size?: "sm" | "xs" }) {
  return (
    <span
      title={`Team grade ${summary.letter} (${summary.score}/100, ${summary.count} ${summary.count === 1 ? "grade" : "grades"})`}
      className={`inline-flex items-center rounded-md font-bold ring-1 ring-inset ${LETTER_STYLES[summary.letter]} ${
        size === "xs" ? "px-1 text-[9px]" : "px-1.5 py-0.5 text-[11px]"
      }`}
    >
      {summary.letter}
    </span>
  );
}

export function GradePanel({
  eventExternalId,
  memberId,
  onSaved,
}: {
  eventExternalId: string;
  memberId: string | null;
  onSaved?: () => void;
}) {
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [summary, setSummary] = useState<GradeSummary | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  const [density, setDensity] = useState<FounderDensity | null>(null);
  const [visaFit, setVisaFit] = useState(0);
  const [sellersHeavy, setSellersHeavy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/grades?event_id=${encodeURIComponent(eventExternalId)}`).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    setGrades(data?.grades ?? []);
    setSummary(data?.summary ?? null);
    setSetupNeeded(Boolean(data?.setupNeeded));
    setLoaded(true);
  }, [eventExternalId]);

  useEffect(() => {
    load();
  }, [load]);

  const mine = useMemo(() => grades.find((g) => g.teamMemberId === memberId) ?? null, [grades, memberId]);

  // Prefill from my existing grade when I open the editor.
  useEffect(() => {
    if (!mine) return;
    setDensity(mine.founderDensity);
    setVisaFit(mine.visaFit);
    setSellersHeavy(mine.sellersHeavy);
    setVerdict(mine.verdict);
    setNotes(mine.notes ?? "");
  }, [mine]);

  const preview = density && verdict ? computeGrade({ founderDensity: density, visaFit, sellersHeavy, verdict }) : null;
  const showForm = editing || (!mine && loaded);

  async function save() {
    if (!density || !verdict || saving) return;
    if (!memberId) {
      setError("Pick who you are first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventExternalId, teamMemberId: memberId, founderDensity: density, visaFit, sellersHeavy, verdict, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setEditing(false);
      await load();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  if (setupNeeded) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-[11px] text-gray-400">
        Grading switches on once the database update (supabase/radar-v2.sql) has been run.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">How was it?</p>
        {summary && (
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
            Team grade <GradeBadge summary={summary} />
          </span>
        )}
      </div>

      {grades.length > 0 && (
        <ul className="mb-3 space-y-1">
          {grades.map((g) => (
            <li key={g.id} className="flex items-start gap-2 text-[11px] text-gray-600">
              <GradeBadge summary={{ score: g.score, letter: letterFor(g.score), count: 1 }} size="xs" />
              <span>
                <span className="font-semibold text-gray-800">{g.memberName ?? g.teamMemberId}</span>: {DENSITY_LABELS[g.founderDensity].toLowerCase()} founders,{" "}
                {g.visaFit} visa-fit, {VERDICT_LABELS[g.verdict].toLowerCase()}
                {g.sellersHeavy ? ", lots of sellers" : ""}
                {g.notes ? <span className="text-gray-400">. {g.notes}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!showForm && mine && (
        <button type="button" onClick={() => setEditing(true)} className="text-[11px] font-semibold text-gray-500 hover:text-gray-800">
          Edit my grade
        </button>
      )}

      {showForm && (
        <div className="space-y-2.5">
          <div>
            <p className="mb-1 text-[11px] text-gray-500">Founders in the room</p>
            <Segmented options={DENSITIES} labels={DENSITY_LABELS} value={density} onChange={setDensity} />
          </div>
          <div>
            <p className="mb-1 text-[11px] text-gray-500">People who looked like O-1A candidates</p>
            <div className="inline-flex items-center rounded-lg bg-white ring-1 ring-gray-200">
              <button type="button" aria-label="One fewer" onClick={() => setVisaFit((n) => Math.max(0, n - 1))} className="px-2.5 py-1 text-sm text-gray-500 hover:text-gray-900">
                −
              </button>
              <span className="min-w-6 text-center text-xs font-semibold tabular-nums text-gray-900">{visaFit}</span>
              <button type="button" aria-label="One more" onClick={() => setVisaFit((n) => n + 1)} className="px-2.5 py-1 text-sm text-gray-500 hover:text-gray-900">
                +
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-gray-600">
            <input type="checkbox" checked={sellersHeavy} onChange={(e) => setSellersHeavy(e.target.checked)} className="rounded border-gray-300" />
            Mostly service providers, recruiters or other sellers
          </label>
          <div>
            <p className="mb-1 text-[11px] text-gray-500">Next time?</p>
            <Segmented options={VERDICTS} labels={VERDICT_LABELS} value={verdict} onChange={setVerdict} />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything worth remembering (optional)"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!density || !verdict || saving}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-700 disabled:opacity-40"
            >
              {saving ? "Saving…" : mine ? "Update grade" : "Save grade"}
            </button>
            {preview !== null && (
              <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                Grade <GradeBadge summary={{ score: preview, letter: letterFor(preview), count: 1 }} />
              </span>
            )}
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-gray-400 hover:text-gray-700">
                Cancel
              </button>
            )}
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
