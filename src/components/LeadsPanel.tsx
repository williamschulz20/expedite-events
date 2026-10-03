"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createLead,
  deleteLead,
  fetchLeads,
  tallyLeads,
  updateLead,
  type CapturedLead,
  type LeadQuality,
  type LeadTally,
} from "@/lib/leads";
import { QualityToggle } from "./QualityToggle";

// The morning-after capture flow: who we spoke to, and what we thought.
//
// Built for speed over completeness. Name is the only required field, because
// a room's worth of names captured roughly beats three perfect records and
// twenty-six people nobody wrote down.

const EMPTY_DRAFT = { name: "", title: "", company: "", linkedin_url: "" };

export function LeadsPanel({
  eventExternalId,
  capturedBy,
  onTallyChange,
}: {
  eventExternalId: string;
  capturedBy?: string | null;
  /** Derived counts for the debrief panel, so it never refetches these rows. */
  onTallyChange?: (tally: LeadTally) => void;
}) {
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ids mid-flight, so a row's toggle disables itself without freezing the
  // whole list while someone works down a long set of names.
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setLeads(await fetchLeads(eventExternalId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the people met");
    } finally {
      setLoading(false);
    }
  }, [eventExternalId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createLead({
        event_external_id: eventExternalId,
        name: draft.name,
        title: draft.title || undefined,
        company: draft.company || undefined,
        linkedin_url: draft.linkedin_url || undefined,
        captured_by: capturedBy ?? null,
      });
      setLeads((prev) => [created, ...prev]);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that person");
    } finally {
      setSaving(false);
    }
  }

  async function rate(lead: CapturedLead, quality: LeadQuality | null) {
    const previous = lead.lead_quality;
    // Optimistic: rating a room is a rapid series of taps and a round trip
    // between each one makes the whole flow feel like paperwork.
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, lead_quality: quality } : l)));
    setPending((prev) => new Set(prev).add(lead.id));
    try {
      await updateLead(lead.id, { lead_quality: quality });
    } catch (err) {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, lead_quality: previous } : l)));
      setError(err instanceof Error ? err.message : "Could not save that rating");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  }

  async function remove(lead: CapturedLead) {
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
    try {
      await deleteLead(lead.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that person");
      void load();
    }
  }

  const tally = tallyLeads(leads);

  useEffect(() => {
    onTallyChange?.(tally);
    // Keyed on the rows rather than the derived object, which is rebuilt on
    // every render and would otherwise re-fire this forever.
  }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">
          People met ({tally.total})
        </h3>
        {tally.unrated > 0 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
            {tally.unrated} unrated
          </span>
        )}
        {tally.hot > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
            {tally.hot} hot
          </span>
        )}
      </div>

      {/* Quick add. Enter submits, so a list of names goes in without reaching
          for the mouse.

          Laid out with flex-wrap rather than a `sm:` grid on purpose: this
          panel renders inside a narrow modal, and Tailwind's breakpoints are
          viewport-based, so a responsive grid would stay four columns wide in
          a 430px dialog and push the button off the edge. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ["name", "Name", "min-w-[8rem] flex-[2]"],
            ["title", "Title", "min-w-[7rem] flex-1"],
            ["company", "Company", "min-w-[7rem] flex-1"],
            ["linkedin_url", "LinkedIn URL", "min-w-[10rem] flex-[2]"],
          ] as const
        ).map(([field, label, width]) => (
          <input
            key={field}
            value={draft[field]}
            onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder={label}
            className={`${width} rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-400`}
          />
        ))}
        <button
          type="button"
          onClick={() => void add()}
          disabled={!draft.name.trim() || saving}
          className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="py-4 text-center text-xs text-gray-400">Loading...</p>
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center">
          <p className="text-xs text-gray-500">Nobody captured from this event yet</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Add them while you still remember the conversation
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {leads.map((lead) => (
            <li key={lead.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-gray-900">{lead.name}</span>
                  {lead.linkedin_url && (
                    <a
                      href={lead.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-semibold text-blue-600 hover:underline"
                    >
                      in
                    </a>
                  )}
                </div>
                <p className="truncate text-[11px] text-gray-500">
                  {[lead.title, lead.company].filter(Boolean).join(" · ") || "No title"}
                </p>
              </div>
              {lead.gtm_deal_id && (
                <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  Deal
                </span>
              )}
              <QualityToggle
                value={lead.lead_quality}
                disabled={pending.has(lead.id)}
                onChange={(next) => void rate(lead, next)}
              />
              <button
                type="button"
                onClick={() => void remove(lead)}
                aria-label={`Remove ${lead.name}`}
                className="shrink-0 rounded px-1 text-xs text-gray-300 transition hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
