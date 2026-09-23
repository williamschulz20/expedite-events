"use client";

import { useState } from "react";
import { costPerHotLead, formatMoney, saveDebrief } from "@/lib/leads";

// What the event cost and how it went.
//
// Spend and outcome sit next to each other on purpose: an event with a cost
// and no hot leads is the case worth seeing, and it stays invisible while the
// two live on different screens.

const CURRENCIES = ["GBP", "USD", "EUR"] as const;

export function DebriefPanel({
  dbId,
  initialCost,
  initialCurrency,
  initialNotes,
  attended,
  hotCount,
  totalLeads,
  debriefedBy,
  onSaved,
}: {
  dbId: string;
  initialCost: number | null;
  initialCurrency: string | null;
  initialNotes: string | null;
  attended: boolean;
  hotCount: number;
  totalLeads: number;
  debriefedBy?: string | null;
  onSaved?: () => void;
}) {
  const [cost, setCost] = useState(initialCost === null ? "" : String(initialCost));
  const [currency, setCurrency] = useState(initialCurrency ?? "GBP");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const costValue = cost.trim() === "" ? null : Number(cost);
  const perHot = costPerHotLead(costValue, hotCount);

  async function save() {
    if (saving) return;
    if (costValue !== null && (!Number.isFinite(costValue) || costValue < 0)) {
      setError("Cost must be a positive number");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDebrief({
        dbId,
        cost: costValue,
        currency,
        debrief_notes: notes,
        debriefed_by: debriefedBy ?? null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the debrief");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">
        What it returned
      </h3>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Attended" value={attended ? "Yes" : "Not marked"} />
        <Stat label="People met" value={String(totalLeads)} />
        <Stat label="Hot leads" value={String(hotCount)} />
        <Stat
          label="Cost per hot lead"
          value={perHot === null ? "Unknown" : formatMoney(perHot, currency)}
          hint={
            perHot !== null
              ? undefined
              : costValue === null || costValue <= 0
                ? "Needs spend"
                : "Needs a hot lead"
          }
        />
      </div>

      <div className="mb-2 flex gap-2">
        <input
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          inputMode="decimal"
          placeholder="What it cost"
          className="w-36 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none placeholder:text-gray-400 focus:border-gray-400"
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-gray-400"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="How was the room? Who was actually there?"
        className="mb-2 w-full resize-y rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none placeholder:text-gray-400 focus:border-gray-400"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-700 disabled:opacity-40"
        >
          Save debrief
        </button>
        {saved && <span className="text-[11px] font-semibold text-green-600">Saved</span>}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
      {hint && <p className="text-[10px] text-gray-400">{hint}</p>}
    </div>
  );
}
