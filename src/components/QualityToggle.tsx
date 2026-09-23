"use client";

import { LEAD_QUALITIES, type LeadQuality } from "@/lib/leads";

// Selected styling per rating. An unset control stays visibly empty rather
// than defaulting to a value: unrated is a real state the debrief is trying
// to drive to zero, and a default would hide it.
const ON: Record<LeadQuality, string> = {
  hot: "bg-red-50 text-red-700 ring-red-200",
  warm: "bg-amber-50 text-amber-700 ring-amber-200",
  cold: "bg-sky-50 text-sky-700 ring-sky-200",
};

const OFF = "bg-white text-gray-400 ring-gray-200 hover:bg-gray-50 hover:text-gray-600";

export function QualityToggle({
  value,
  onChange,
  disabled,
}: {
  value: LeadQuality | null;
  onChange: (next: LeadQuality | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg" role="group" aria-label="Lead quality">
      {LEAD_QUALITIES.map((quality) => {
        const active = value === quality;
        return (
          <button
            key={quality}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            // Pressing the active rating clears it, so a mis-tap is one click
            // to undo rather than a value stuck on the record.
            onClick={() => onChange(active ? null : quality)}
            className={[
              "px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 transition first:rounded-l-lg last:rounded-r-lg",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active ? ON[quality] : OFF,
            ].join(" ")}
          >
            {quality}
          </button>
        );
      })}
    </div>
  );
}
