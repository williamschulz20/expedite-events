"use client";

import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { GradePanel } from "@/components/GradePanel";

// Past events you said you were going to and have not graded yet. Grades only
// teach the scorer if they get written, and the moment people remember to is
// the next time they open the app, so the ask lives at the top of the page.

type Pending = { id: string; title: string; date: string; location: string | null; url: string | null };

export function GradeQueue({ memberId, onGraded }: { memberId: string | null; onGraded?: () => void }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [active, setActive] = useState<Pending | null>(null);

  const load = useCallback(() => {
    if (!memberId) return;
    fetch(`/api/grades?pending_for=${encodeURIComponent(memberId)}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setPending(d.events ?? []))
      .catch(() => {});
  }, [memberId]);

  useEffect(() => {
    load();
  }, [load]);

  if (pending.length === 0) return null;

  return (
    <>
      <div className="mb-6 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3">
        <p className="text-xs font-semibold text-violet-900">
          You went to {pending.length} {pending.length === 1 ? "event" : "events"} recently. Grade {pending.length === 1 ? "it" : "them"} so the radar learns what is worth going to.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pending.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActive(p)}
              className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-violet-800 ring-1 ring-violet-200 transition hover:ring-violet-400"
            >
              {p.title.length > 48 ? `${p.title.slice(0, 48)}…` : p.title}
              <span className="ml-1.5 text-violet-400">{(() => { try { return format(parseISO(p.date), "d MMM"); } catch { return ""; } })()}</span>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
          onClick={(e) => e.target === e.currentTarget && setActive(null)}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold leading-snug text-gray-900">{active.title}</h2>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {(() => { try { return format(parseISO(active.date), "EEEE d MMMM"); } catch { return ""; } })()}
                  {active.location ? ` · ${active.location}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setActive(null)} className="text-xs text-gray-400 hover:text-gray-700">
                Close
              </button>
            </div>
            <GradePanel
              eventExternalId={active.id}
              memberId={memberId}
              onSaved={() => {
                setActive(null);
                load();
                onGraded?.();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
