"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { eventClock, eventDay, zoneLabel } from "@/lib/eventTime";

// "Where should I go this week?" answered directly: the best events in the
// next seven days for one city, ranked by score, with who on the team is
// already going and a one-tap "I'm going". The calendar answers "what is on";
// this answers "what is worth an evening", which is the question people open
// the app with.

const DAYS_AHEAD = 7;
const TOP_N = 10;
const CITY_KEY = "radar-week-city";

export interface WeekEvent {
  id: string;
  title: string;
  date: string;
  location: string;
  url: string;
  city?: string | null;
  leadScore?: number;
  leadTier?: "hot" | "warm" | "cold";
  leverageReason?: string;
  adjustments?: { delta: number; reason: string }[];
  timeKnown?: boolean;
  source: string;
  timeZone?: string | null;
}

export interface WeekAttendee {
  memberId: string;
  memberName: string;
  initials: string;
  avatarColor: string;
}

function readCity(): string {
  try {
    return localStorage.getItem(CITY_KEY) ?? "Anywhere";
  } catch {
    return "Anywhere";
  }
}

export function ThisWeekView<E extends WeekEvent>({
  events,
  attendanceByEvent,
  myId,
  onToggleAttendance,
  onOpen,
}: {
  events: E[];
  attendanceByEvent: Record<string, WeekAttendee[]>;
  myId: string | null;
  onToggleAttendance: (eventId: string) => void;
  onOpen: (event: E) => void;
}) {
  const [city, setCity] = useState("Anywhere");
  useEffect(() => setCity(readCity()), []);
  const pick = (c: string) => {
    setCity(c);
    try {
      localStorage.setItem(CITY_KEY, c);
    } catch {
      /* private mode: the pick just isn't remembered */
    }
  };

  const week = useMemo(() => {
    const now = Date.now();
    const end = now + DAYS_AHEAD * 86_400_000;
    return events.filter((e) => {
      const t = Date.parse(e.timeKnown === false ? `${e.date.slice(0, 10)}T23:59:00` : e.date);
      return t >= now && t <= end && (e.leadTier === "hot" || e.leadTier === "warm");
    });
  }, [events]);

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of week) if (e.city) counts.set(e.city, (counts.get(e.city) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [week]);

  const picks = useMemo(
    () =>
      week
        .filter((e) => city === "Anywhere" || e.city === city)
        .sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0))
        .slice(0, TOP_N),
    [week, city]
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 px-5 py-3">
        <p className="mr-2 text-xs font-semibold text-gray-900">Best of the next 7 days</p>
        {["Anywhere", ...cities.map(([c]) => c)].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pick(c)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
              city === c ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-500 hover:text-gray-800"
            }`}
          >
            {c}
            {c !== "Anywhere" && <span className="ml-1 opacity-60">{cities.find(([n]) => n === c)?.[1]}</span>}
          </button>
        ))}
        {city !== "Anywhere" && !cities.some(([c]) => c === city) && (
          <span className="text-[11px] text-gray-400">Nothing hot or warm in {city} this week.</span>
        )}
      </div>

      {picks.length === 0 ? (
        <p className="px-5 py-16 text-center text-xs text-gray-400">No hot or warm events in the next 7 days match your filters.</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {picks.map((e, i) => {
            const going = attendanceByEvent[e.id] ?? [];
            const imGoing = myId ? going.some((a) => a.memberId === myId) : false;
            const penalties = (e.adjustments ?? []).filter((a) => a.delta < 0);
            let when = "";
            try {
              const clock = eventClock(e);
              const zone = zoneLabel(e);
              when = `${format(parseISO(eventDay(e)), "EEE d MMM")} · ${clock ? `${clock}${zone ? ` ${zone}` : ""}` : "time TBC"}`;
            } catch {
              /* leave blank */
            }
            return (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3.5">
                <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-gray-300">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpen(e)} className="block text-left text-sm font-semibold leading-snug text-gray-900 hover:underline">
                    {e.title}
                  </button>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {when}
                    {e.location ? ` · ${e.location.length > 60 ? `${e.location.slice(0, 60)}…` : e.location}` : ""}
                  </p>
                  {(e.leverageReason || penalties.length > 0) && (
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {e.leverageReason}
                      {penalties.length > 0 && <span className="text-red-600"> · {penalties[0].reason.split(":")[0]}</span>}
                    </p>
                  )}
                  {going.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-1">
                      {going.map((a) => (
                        <span
                          key={a.memberId}
                          title={a.memberName}
                          style={{ backgroundColor: a.avatarColor }}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        >
                          {a.initials}
                        </span>
                      ))}
                      <span className="ml-1 text-[11px] text-gray-400">going</span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                      e.leadTier === "hot" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {e.leadScore ?? "–"}
                  </span>
                  {myId && (
                    <button
                      type="button"
                      onClick={() => onToggleAttendance(e.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
                        imGoing ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-600 ring-gray-200 hover:ring-gray-400"
                      }`}
                    >
                      {imGoing ? "Going ✓" : "I'm going"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
