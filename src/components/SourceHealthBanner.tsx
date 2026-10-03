"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";

// A dead feed used to be invisible: the daily job went green while Eventbrite
// had failed for a week. This reads the per-source results the job records
// and says plainly which feeds are not updating.

type SourceHealth = {
  source: string;
  ok: boolean;
  lastRunAt: string;
  lastSuccessAt: string | null;
  scraped: number;
  error: string | null;
};

const NAMES: Record<string, string> = {
  "luma-scrape": "Luma",
  eventbrite: "Eventbrite",
  "eventbrite-deep": "Eventbrite (year ahead)",
  meetup: "Meetup",
  garysguide: "Gary's Guide",
  devevents: "dev.events",
  confstech: "confs.tech",
  conferences: "Conferences",
  startupgrind: "Startup Grind",
  selectusa: "SelectUSA",
  websearch: "Web search",
  partiful: "Partiful",
};

function ago(iso: string | null) {
  if (!iso) return "never";
  try {
    return `${formatDistanceToNowStrict(parseISO(iso))} ago`;
  } catch {
    return "unknown";
  }
}

export function SourceHealthBanner() {
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/source-runs")
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((d) => setSources(d.sources ?? []))
      .catch(() => {});
  }, []);

  if (sources.length === 0) return null;
  const failing = sources.filter((s) => !s.ok);
  const lastRun = sources.map((s) => s.lastRunAt).sort().at(-1) ?? null;

  return (
    <div className={`mb-6 rounded-lg border px-4 py-2.5 text-xs ${failing.length ? "border-amber-200 bg-amber-50/60" : "border-gray-200 bg-white"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className={`h-2 w-2 shrink-0 rounded-full ${failing.length ? "bg-amber-500" : "bg-emerald-500"}`} />
        <span className="text-gray-700">
          {failing.length === 0
            ? `All ${sources.length} sources updated ${ago(lastRun)}`
            : `${failing.length} of ${sources.length} sources not updating: ${failing
                .map((s) => `${NAMES[s.source] ?? s.source} (last worked ${ago(s.lastSuccessAt)})`)
                .join(", ")}`}
        </span>
        <span className="ml-auto shrink-0 text-gray-400">{open ? "Hide" : "Details"}</span>
      </button>
      {open && (
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {sources
            .slice()
            .sort((a, b) => Number(a.ok) - Number(b.ok) || a.source.localeCompare(b.source))
            .map((s) => (
              <li key={s.source} className="flex items-center gap-2 text-gray-600">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.ok ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className="font-medium text-gray-800">{NAMES[s.source] ?? s.source}</span>
                <span className="truncate text-gray-400">
                  {s.ok ? `${s.scraped} events, ${ago(s.lastRunAt)}` : `${s.error ?? "failed"}, last worked ${ago(s.lastSuccessAt)}`}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
