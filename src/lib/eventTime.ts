// Showing an event's time in the venue's own clock.
//
// Sources store times two ways. Luma, Meetup and Partiful give real instants
// (a San Francisco 6:30pm is 01:30Z). Eventbrite, Gary's Guide, dev.events and
// the conference lists give the venue's wall-clock time with no zone, which
// the database stores as if it were UTC. Formatting both in the viewer's zone
// put SF demo nights at 1:30 AM and every Eventbrite event an hour out in
// London. Instants are shown in the venue's zone; wall-clock times are shown
// exactly as written.

const WALL_CLOCK_SOURCES = new Set([
  "eventbrite", "garysguide", "conference", "confstech", "devevents", "websearch",
  "startupgrind", "selectusa", "university", "tentimes", "googlesearch", "f6s",
]);

export interface TimedEvent {
  date: string;
  source: string;
  timeZone?: string | null;
  timeKnown?: boolean;
}

/** The zone to format this event's stored time in; undefined means the viewer's own. */
export function displayZone(ev: TimedEvent): string | undefined {
  if (WALL_CLOCK_SOURCES.has(ev.source)) return "UTC";
  return ev.timeZone ?? undefined;
}

function parts(ev: TimedEvent, iso: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return {};
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: displayZone(ev) }).formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "YYYY-MM-DD" in the venue's calendar. */
export function eventDay(ev: TimedEvent): string {
  if (ev.timeKnown === false) return ev.date.slice(0, 10);
  const p = parts(ev, ev.date, { year: "numeric", month: "2-digit", day: "2-digit" });
  return p.year ? `${p.year}-${p.month}-${p.day}` : ev.date.slice(0, 10);
}

/** "6:30 pm" in the venue's clock, or null when the source gave no time. */
export function eventClock(ev: TimedEvent, iso = ev.date): string | null {
  if (ev.timeKnown === false) return null;
  const p = parts(ev, iso, { hour: "numeric", minute: "2-digit", hour12: true });
  return p.hour ? `${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()}`.trim() : null;
}

/** "18:30" in the venue's clock, for tight spaces. */
export function eventClock24(ev: TimedEvent): string | null {
  if (ev.timeKnown === false) return null;
  const p = parts(ev, ev.date, { hour: "2-digit", minute: "2-digit", hour12: false });
  return p.hour ? `${p.hour}:${p.minute}` : null;
}

/** Short zone label ("PDT", "BST") when it differs from the viewer's, so a time is never ambiguous. */
export function zoneLabel(ev: TimedEvent): string | null {
  const zone = displayZone(ev);
  if (!zone || zone === "UTC") return null;
  const viewer = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === viewer) return null;
  const d = new Date(ev.date);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(d);
  return p.find((x) => x.type === "timeZoneName")?.value ?? null;
}
