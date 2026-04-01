"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  isToday,
} from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FounderEvent {
  id: string;
  dbId?: string;
  title: string;
  description: string;
  date: string;
  endDate?: string;
  location: string;
  url: string;
  source: string;
  category: string;
  imageUrl?: string;
  leadScore?: number;
  leadTier?: "hot" | "warm" | "cold";
  highLeverage?: boolean;
  leverageReason?: string;
  acceptedAt?: string;
  attendedAt?: string;
  organizerName?: string;
  organizerLumaId?: string;
  organizerLinkedin?: string;
  organizerUsername?: string;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  initials: string;
  avatar_color: string;
  calendar_setup_done: boolean;
}

interface AttendeeInfo {
  attendanceId: string;
  memberId: string;
  memberName: string;
  initials: string;
  avatarColor: string;
  status: string;
}

interface OrganizerRow {
  id: string;
  name: string;
  org_name?: string | null;
  username?: string;
  linkedin_handle?: string;
  twitter_handle?: string;
  website?: string;
  avatar_url?: string;
  primary_city?: string;
  total_events: number;
  hot_events: number;
  warm_events: number;
  cold_events: number;
  luma_profile_url?: string;
  linkedin_url?: string | null;
}

interface Identity {
  teamMemberId: string;
  name: string;
  initials: string;
  avatarColor: string;
  calendarSetupDone: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_TABS = [
  { id: "All",          label: "All" },
  { id: "hackathon",    label: "Hackathon" },
  { id: "demo-day",     label: "Demo Day" },
  { id: "pitch",        label: "Pitch" },
  { id: "networking",   label: "Networking" },
  { id: "fundraising",  label: "Fundraising" },
  { id: "accelerator",  label: "Accelerator" },
  { id: "dinner-breakfast", label: "Dinners & Breakfasts" },
  { id: "workshop",     label: "Workshop" },
] as const;

const TIER_TABS = [
  { id: "All",  label: "All" },
  { id: "hot",  label: "🔥 Hot" },
  { id: "warm", label: "🟡 Warm" },
  { id: "cold", label: "🧊 Cold" },
] as const;

const SOURCE_TABS = [
  { id: "All",         label: "All sources" },
  { id: "Luma",        label: "Luma" },
  { id: "Eventbrite",  label: "Eventbrite" },
  { id: "Partiful",    label: "Partiful" },
  { id: "Conference",  label: "Conferences" },
  { id: "Other",       label: "Other" },
] as const;

const OTHER_SOURCES = new Set([
  "websearch", "googlesearch", "confstech", "f6s",
  "selectusa", "university", "devevents", "garysguide", "tentimes",
  "startupgrind", "meetup",
]);

const KNOWN_CITIES = [
  "London", "Berlin", "Paris", "Amsterdam", "San Francisco",
  "Los Angeles", "New York", "Austin", "Boston",
  "Munich", "Barcelona", "Zurich", "Stockholm", "Helsinki",
  "Lisbon", "Dublin", "Copenhagen", "Milan", "Madrid",
  "Istanbul", "Vienna", "Warsaw", "Brussels", "Hamburg",
  "Budapest", "Prague", "Geneva", "Lausanne", "Rome",
  "Tallinn", "Riga", "Vilnius", "Oslo",
];

// Fallback team when Supabase team_members table is empty/unavailable
const DEFAULT_TEAM: TeamMember[] = [
  { id: "w", name: "William", email: "", initials: "W", avatar_color: "#6366f1", calendar_setup_done: false },
  { id: "l", name: "Lina", email: "", initials: "L", avatar_color: "#ec4899", calendar_setup_done: false },
  { id: "q", name: "Quinn", email: "", initials: "Q", avatar_color: "#f59e0b", calendar_setup_done: false },
  { id: "l2", name: "Leo", email: "", initials: "L", avatar_color: "#10b981", calendar_setup_done: false },
  { id: "t", name: "Tom", email: "", initials: "T", avatar_color: "#3b82f6", calendar_setup_done: false },
];

function extractCity(location: string): string {
  if (!location) return "Other";
  const loc = location.toLowerCase();
  if (loc.includes("san francisco") || loc.includes(", ca ") || loc.includes("sf,")) return "San Francisco";
  for (const city of KNOWN_CITIES) {
    if (loc.includes(city.toLowerCase())) return city;
  }
  return "Other";
}

// Detect if event is free or paid from title/description
function detectPricing(title: string, desc: string): "free" | "paid" | null {
  const text = `${title} ${desc}`.toLowerCase();
  const freeSignals = ["free", "no cost", "complimentary", "free entry", "free event", "free admission", "free ticket", "no charge", "gratis"];
  const paidSignals = ["£", "$", "€", "paid", "ticket price", "buy ticket", "purchase ticket", "registration fee", "early bird"];
  if (freeSignals.some((s) => text.includes(s))) return "free";
  if (paidSignals.some((s) => text.includes(s))) return "paid";
  return null;
}

const TIER_STYLES = {
  hot:  { border: "border-l-red-500",   dot: "bg-red-500",   label: "Hot",  labelCls: "text-red-600 bg-red-50 ring-red-200" },
  warm: { border: "border-l-amber-400", dot: "bg-amber-400", label: "Warm", labelCls: "text-amber-700 bg-amber-50 ring-amber-200" },
  cold: { border: "border-l-blue-200",  dot: "bg-blue-300",  label: "Cold", labelCls: "text-blue-600 bg-blue-50 ring-blue-200" },
};

const SOURCE_STYLES: Record<string, string> = {
  luma:       "text-violet-700 bg-violet-50 ring-violet-200",
  eventbrite: "text-orange-700 bg-orange-50 ring-orange-200",
  partiful:   "text-pink-700 bg-pink-50 ring-pink-200",
  other:      "text-teal-700 bg-teal-50 ring-teal-200",
  meetup:     "text-red-700 bg-red-50 ring-red-200",
  conference: "text-indigo-700 bg-indigo-50 ring-indigo-200",
  websearch:  "text-teal-700 bg-teal-50 ring-teal-200",
  googlesearch: "text-teal-700 bg-teal-50 ring-teal-200",
  confstech:  "text-teal-700 bg-teal-50 ring-teal-200",
  f6s:        "text-teal-700 bg-teal-50 ring-teal-200",
  selectusa:  "text-teal-700 bg-teal-50 ring-teal-200",
  university: "text-teal-700 bg-teal-50 ring-teal-200",
  devevents:  "text-teal-700 bg-teal-50 ring-teal-200",
  garysguide: "text-teal-700 bg-teal-50 ring-teal-200",
  tentimes:   "text-teal-700 bg-teal-50 ring-teal-200",
  startupgrind: "text-teal-700 bg-teal-50 ring-teal-200",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function formatEventDate(iso: string) {
  try {
    const d = parseISO(iso);
    return {
      day:  format(d, "EEE"),
      date: format(d, "d MMM"),
      time: format(d, "h:mm a"),
    };
  } catch {
    return { day: "—", date: "—", time: "—" };
  }
}

// ---------------------------------------------------------------------------
// Avatar circle component
// ---------------------------------------------------------------------------

function AvatarCircle({
  initials,
  color,
  size = "sm",
  title,
  onClick,
  active = false,
  faded = false,
}: {
  initials: string;
  color: string;
  size?: "sm" | "md" | "lg";
  title?: string;
  onClick?: () => void;
  active?: boolean;
  faded?: boolean;
}) {
  const sizeClass = size === "lg" ? "h-10 w-10 text-sm" : size === "md" ? "h-7 w-7 text-xs" : "h-6 w-6 text-[10px]";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{ backgroundColor: color, opacity: faded ? 0.4 : 1 }}
      className={`${sizeClass} inline-flex items-center justify-center rounded-full font-bold text-white ring-2 ${active ? "ring-gray-900" : "ring-white"} transition-all hover:ring-gray-400 shrink-0`}
    >
      {initials}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AvatarStack — overlapping circles with hover tooltips
// ---------------------------------------------------------------------------

function AvatarStack({
  attendees,
  size = "sm",
}: {
  attendees: Array<{ memberId: string; memberName: string; initials: string; avatarColor: string }>;
  size?: "sm" | "md";
}) {
  if (attendees.length === 0) return null;
  const dim = size === "md" ? "h-7 w-7 text-[10px]" : "h-6 w-6 text-[9px]";
  const overlap = size === "md" ? -8 : -6;

  return (
    <div className="flex items-center" style={{ paddingLeft: 0 }}>
      {attendees.map((a, i) => (
        <div
          key={a.memberId}
          className="relative group"
          style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: attendees.length - i }}
        >
          <div
            style={{ backgroundColor: a.avatarColor }}
            className={`${dim} rounded-full border-2 border-white flex items-center justify-center font-bold text-white shrink-0`}
          >
            {a.initials}
          </div>
          {/* Tooltip */}
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50">
            <div className="rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white whitespace-nowrap shadow-lg">
              {a.memberName}
            </div>
            <div className="mx-auto h-1.5 w-1.5 -mt-px rotate-45 bg-gray-900" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function TierDot({ tier }: { tier: "hot" | "warm" | "cold" }) {
  return (
    <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_STYLES[tier].dot}`} />
  );
}

// ---------------------------------------------------------------------------
// Attendance avatars row
// ---------------------------------------------------------------------------

function AttendanceRow({
  eventId,
  attendanceByEvent,
  currentIdentity,
  teamMembers,
  onToggle,
}: {
  eventId: string;
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  currentIdentity: Identity | null;
  teamMembers: TeamMember[];
  onToggle: (eventId: string) => void;
}) {
  const attendees = attendanceByEvent[eventId] ?? [];
  const myAttendance = currentIdentity
    ? attendees.find((a) => a.memberId === currentIdentity.teamMemberId)
    : undefined;
  const imGoing = !!myAttendance;

  if (teamMembers.length === 0) return null;

  const myMember = currentIdentity
    ? teamMembers.find((m) => m.id === currentIdentity.teamMemberId)
    : undefined;

  return (
    <div className="flex items-center gap-2 mt-1.5">
      {/* Going: overlapping AvatarStack */}
      {attendees.length > 0 && (
        <AvatarStack attendees={attendees} />
      )}
      {/* "You" toggle — always show your circle so you can RSVP */}
      {myMember && (
        <button
          type="button"
          title={imGoing ? `You're going — click to cancel` : `Mark yourself as going`}
          onClick={() => onToggle(eventId)}
          style={{ backgroundColor: imGoing ? myMember.avatar_color : undefined }}
          className={`h-6 w-6 rounded-full border-2 text-[9px] font-bold transition shrink-0 ${
            imGoing
              ? "border-white text-white"
              : "border-dashed border-gray-300 text-gray-400 bg-white hover:border-gray-400"
          }`}
        >
          {imGoing ? myMember.initials : "+"}
        </button>
      )}
      {attendees.length > 0 && (
        <span className="text-[10px] text-gray-400 tabular-nums">
          {attendees.length} going
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team attendance cluster — all 5 slots, placeholder when not signed up
// ---------------------------------------------------------------------------

function TeamAttendanceCluster({
  eventId,
  attendanceByEvent,
  currentIdentity,
  teamMembers,
  onToggle,
}: {
  eventId: string;
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  currentIdentity: Identity | null;
  teamMembers: TeamMember[];
  onToggle: (eventId: string) => void;
}) {
  const attendees = attendanceByEvent[eventId] ?? [];

  return (
    <div className="flex items-center gap-0.5">
      {teamMembers.map((m) => {
        const isGoing = attendees.some((a) => a.memberId === m.id);
        const isMe = currentIdentity?.teamMemberId === m.id;
        // First letter of first name only
        const letter = m.name.charAt(0).toUpperCase();

        return (
          <div key={m.id} className="relative group">
            <button
              type="button"
              onClick={isMe ? () => onToggle(eventId) : undefined}
              disabled={!isMe}
              style={isGoing ? { backgroundColor: m.avatar_color } : undefined}
              className={[
                "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold transition select-none",
                isGoing
                  ? "text-white border-2 border-white shadow-sm"
                  : "border border-dashed border-gray-300 text-gray-300 bg-white",
                isMe && !isGoing ? "hover:border-gray-400 hover:text-gray-400 cursor-pointer" : "",
                isMe && isGoing ? "ring-2 ring-offset-1 cursor-pointer" : "",
                !isMe ? "cursor-default" : "",
              ].join(" ")}
            >
              {letter}
            </button>
            {/* Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50">
              <div className="rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white whitespace-nowrap shadow-lg">
                {m.name}{isGoing ? " ✓ going" : isMe ? " — click to join" : ""}
              </div>
              <div className="mx-auto h-1.5 w-1.5 -mt-px rotate-45 bg-gray-900" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Row (list view)
// ---------------------------------------------------------------------------

function EventRow({
  event,
  onAccept,
  onAttend,
  onOpen,
  attendanceByEvent,
  currentIdentity,
  teamMembers,
  onToggleAttendance,
}: {
  event: FounderEvent;
  onAccept: (dbId: string) => void;
  onAttend: (dbId: string) => void;
  onOpen: (event: FounderEvent) => void;
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  currentIdentity: Identity | null;
  teamMembers: TeamMember[];
  onToggleAttendance: (eventId: string) => void;
}) {
  const tier = event.leadTier ?? "cold";
  const ts   = TIER_STYLES[tier];
  const { day, date, time } = formatEventDate(event.date);
  const isPast     = new Date(event.date) < new Date();
  const isAccepted = !!event.acceptedAt;
  const isAttended = !!event.attendedAt;

  return (
    <div
      className={`flex items-start gap-4 border-l-2 ${ts.border} bg-white px-5 py-4 transition-colors hover:bg-gray-50/60 cursor-pointer`}
      onClick={() => onOpen(event)}
    >
      {/* Date column */}
      <div className="hidden w-16 shrink-0 text-right sm:block">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{day}</p>
        <p className="text-sm font-semibold text-gray-900">{date}</p>
        <p className="text-[11px] text-gray-400">{time}</p>
      </div>

      <div className="hidden h-full w-px bg-gray-100 sm:block" />

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {tier !== "cold" && (
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ts.labelCls}`}>
              <TierDot tier={tier} />
              {ts.label}
            </span>
          )}
          {isAccepted && !isAttended && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
              📅 In Calendar
            </span>
          )}
          {isAttended && (
            <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] font-semibold text-green-700 ring-1 ring-inset ring-green-200">
              ✓ Attended
            </span>
          )}
          <Badge cls={SOURCE_STYLES[event.source] ?? "text-gray-600 bg-gray-50 ring-gray-200"}>
            {event.source.charAt(0).toUpperCase() + event.source.slice(1)}
          </Badge>
          <Badge cls="text-gray-500 bg-gray-50 ring-gray-200">
            {event.category}
          </Badge>
          {(() => {
            const pricing = detectPricing(event.title, event.description);
            if (pricing === "free") return <Badge cls="text-emerald-700 bg-emerald-50 ring-emerald-200">Free</Badge>;
            if (pricing === "paid") return <Badge cls="text-red-600 bg-red-50 ring-red-200">Paid</Badge>;
            return null;
          })()}
        </div>

        <p className="text-sm font-semibold text-gray-900 leading-snug">{event.title}</p>

        {event.organizerName && (
          <p className="flex items-center gap-1 text-xs text-gray-500">
            <svg className="h-3 w-3 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <span className="font-medium">by {event.organizerName}</span>
          </p>
        )}

        {event.location && (
          <p className="flex items-center gap-1 text-xs text-gray-400">
            <svg className="h-3 w-3 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span className="truncate max-w-[280px]" title={event.location}>{event.location}</span>
          </p>
        )}

        {event.description && (
          <p className="text-xs leading-relaxed text-gray-400">{truncate(event.description, 140)}</p>
        )}
      </div>

      {/* Right column: actions + team attendance */}
      <div className="flex shrink-0 flex-col items-end gap-2 mt-0.5" onClick={(e) => e.stopPropagation()}>
        {/* Action button */}
        {!isAccepted && event.dbId && (
          <button
            onClick={() => onAccept(event.dbId!)}
            className="rounded-md border border-gray-900 bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-700"
          >
            Accept
          </button>
        )}
        {isAccepted && !isPast && (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 text-center"
          >
            RSVP →
          </a>
        )}
        {isAccepted && isPast && !isAttended && event.dbId && (
          <button
            onClick={() => onAttend(event.dbId!)}
            className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 shadow-sm transition hover:bg-green-100"
          >
            ✓ Attended
          </button>
        )}

        {/* Team attendance — always visible, placeholders when not loaded */}
        {teamMembers.length > 0 ? (
          <TeamAttendanceCluster
            eventId={event.id}
            attendanceByEvent={attendanceByEvent}
            currentIdentity={currentIdentity}
            teamMembers={teamMembers}
            onToggle={onToggleAttendance}
          />
        ) : (
          <div className="flex items-center gap-0.5" title="Team members attending">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-6 w-6 rounded-full border border-dashed border-gray-200 bg-white" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Detail Modal
// ---------------------------------------------------------------------------

function EventDetailModal({
  event,
  onClose,
  onAccept,
  onAttend,
  attendanceByEvent,
  currentIdentity,
  teamMembers,
  onToggleAttendance,
}: {
  event: FounderEvent;
  onClose: () => void;
  onAccept: (dbId: string) => void;
  onAttend: (dbId: string) => void;
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  currentIdentity: Identity | null;
  teamMembers: TeamMember[];
  onToggleAttendance: (eventId: string) => void;
}) {
  const tier      = event.leadTier ?? "cold";
  const ts        = TIER_STYLES[tier];
  const isPast    = new Date(event.date) < new Date();
  const isAccepted = !!event.acceptedAt;
  const isAttended = !!event.attendedAt;

  let dateStr = "—";
  let timeStr = "—";
  try {
    const d = parseISO(event.date);
    dateStr = format(d, "EEEE, d MMMM yyyy");
    timeStr = format(d, "h:mm a");
    if (event.endDate) {
      timeStr += " – " + format(parseISO(event.endDate), "h:mm a");
    }
  } catch { /* keep defaults */ }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const attendees = attendanceByEvent[event.id] ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4"
      onClick={handleBackdrop}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className={`h-1 w-full ${tier === "hot" ? "bg-red-500" : tier === "warm" ? "bg-amber-400" : "bg-gray-200"}`} />

        {event.imageUrl && (
          <div className="h-40 w-full overflow-hidden bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={event.imageUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}

        <div className="px-6 py-5">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Badges */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {tier !== "cold" && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ts.labelCls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${ts.dot}`} />
                {ts.label} Lead
              </span>
            )}
            {event.highLeverage && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-inset ring-purple-200">
                ⚡ High Leverage
              </span>
            )}
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${SOURCE_STYLES[event.source] ?? "text-gray-600 bg-gray-50 ring-gray-200"}`}>
              {event.source.charAt(0).toUpperCase() + event.source.slice(1)}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500 ring-1 ring-inset ring-gray-200">
              {event.category}
            </span>
            {detectPricing(event.title, event.description) === "free" && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                Free
              </span>
            )}
            {detectPricing(event.title, event.description) === "paid" && (
              <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-600 ring-1 ring-inset ring-red-200">
                Paid
              </span>
            )}
            {isAccepted && !isAttended && (
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                📅 In Calendar
              </span>
            )}
            {isAttended && (
              <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700 ring-1 ring-inset ring-green-200">
                ✓ Attended
              </span>
            )}
          </div>

          <h2 className="text-base font-bold text-gray-900 leading-snug mb-3 pr-6">{event.title}</h2>

          <div className="flex flex-col gap-1.5 mb-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <span>{dateStr}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{timeStr}</span>
            </div>
            {event.location && (
              <div className="flex items-start gap-2 text-xs text-gray-500">
                <svg className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                <span>{event.location}</span>
              </div>
            )}
            {event.organizerName && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                <span>
                  {event.organizerUsername ? (
                    <a href={`https://lu.ma/${event.organizerUsername}`} target="_blank" rel="noopener noreferrer" className="hover:underline text-violet-600">
                      {event.organizerName}
                    </a>
                  ) : event.organizerName}
                  {event.organizerLinkedin && (
                    <a href={`https://linkedin.com/in/${event.organizerLinkedin}`} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-600 hover:underline">
                      LinkedIn
                    </a>
                  )}
                </span>
              </div>
            )}
          </div>

          {event.leverageReason && (
            <div className="mb-4 rounded-lg bg-purple-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-purple-600 mb-0.5">Why high leverage</p>
              <p className="text-xs text-purple-800">{event.leverageReason}</p>
            </div>
          )}

          {event.description && (
            <p className="text-xs leading-relaxed text-gray-500 mb-4 line-clamp-4">
              {event.description}
            </p>
          )}

          {/* Team attendance — always visible */}
          <div className="mb-5 rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Team members attending
              </p>
              {currentIdentity && teamMembers.length > 0 && (
                <p className="text-[10px] text-gray-400">
                  Click your circle to join
                </p>
              )}
            </div>
            {teamMembers.length > 0 ? (
              <div className="flex items-center gap-3 flex-wrap">
                {teamMembers.map((m) => {
                  const isAttending = attendees.some((a) => a.memberId === m.id);
                  const isMe = currentIdentity?.teamMemberId === m.id;
                  return (
                    <div key={m.id} className="relative group flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={isMe ? () => onToggleAttendance(event.id) : undefined}
                        disabled={!isMe}
                        style={isAttending ? { backgroundColor: m.avatar_color } : undefined}
                        className={[
                          "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition select-none",
                          isAttending
                            ? "text-white border-2 border-white shadow-sm"
                            : "border border-dashed border-gray-300 text-gray-300 bg-white",
                          isMe && !isAttending ? "hover:border-gray-400 hover:text-gray-400 cursor-pointer" : "",
                          isMe && isAttending ? "ring-2 ring-offset-1 cursor-pointer" : "",
                          !isMe ? "cursor-default" : "",
                        ].join(" ")}
                      >
                        {m.name.charAt(0)}
                      </button>
                      <span className={`text-[9px] font-medium leading-none ${isAttending ? "text-gray-700" : "text-gray-300"}`}>
                        {m.name.split(" ")[0]}
                      </span>
                      {/* Tooltip */}
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50">
                        <div className="rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white whitespace-nowrap shadow-lg">
                          {m.name}{isAttending ? " ✓ going" : isMe ? " — click to join" : ""}
                        </div>
                        <div className="mx-auto h-1.5 w-1.5 -mt-px rotate-45 bg-gray-900" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Placeholder when team hasn't loaded */
              <div className="flex items-center gap-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-8 w-8 rounded-full border border-dashed border-gray-200 bg-white" />
                ))}
                <span className="text-[11px] text-gray-300 ml-1">No one signed up yet</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-700"
            >
              View on {event.source.charAt(0).toUpperCase() + event.source.slice(1)}
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
            {!isAccepted && event.dbId && (
              <button
                onClick={() => { onAccept(event.dbId!); onClose(); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                📅 Add to Calendar
              </button>
            )}
            {isAccepted && isPast && !isAttended && event.dbId && (
              <button
                onClick={() => { onAttend(event.dbId!); onClose(); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-xs font-semibold text-green-700 shadow-sm transition hover:bg-green-100"
              >
                ✓ Mark Attended
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar view — Month / Week / Day modes
// ---------------------------------------------------------------------------

type CalendarMode = "month" | "week" | "day";

const CHIP_COLORS: Record<string, string> = {
  hot:  "bg-red-100 text-red-800 hover:bg-red-200",
  warm: "bg-amber-100 text-amber-800 hover:bg-amber-200",
  cold: "bg-gray-100 text-gray-600 hover:bg-gray-200",
};

function buildEventsByDay(events: FounderEvent[]) {
  const map = new Map<string, FounderEvent[]>();
  for (const ev of events) {
    try {
      const key = format(parseISO(ev.date), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    } catch { /* skip */ }
  }
  map.forEach((arr) => {
    arr.sort((a, b) => {
      const order = { hot: 0, warm: 1, cold: 2 };
      const diff = (order[a.leadTier ?? "cold"]) - (order[b.leadTier ?? "cold"]);
      return diff !== 0 ? diff : new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  });
  return map;
}

function EventChip({ ev, onClick }: { ev: FounderEvent; onClick: () => void }) {
  const chipCls = CHIP_COLORS[ev.leadTier ?? "warm"];
  let timeLabel = "";
  try { timeLabel = format(parseISO(ev.date), "H:mm"); } catch { /* skip */ }
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight transition truncate ${chipCls}`}
      title={ev.organizerName ? `${ev.title} — by ${ev.organizerName}` : ev.title}
    >
      <span className="opacity-60 mr-1">{timeLabel}</span>
      {detectPricing(ev.title, ev.description) === "free" && <span className="text-emerald-600 mr-0.5">●</span>}
      {detectPricing(ev.title, ev.description) === "paid" && <span className="text-red-500 mr-0.5">●</span>}
      {ev.title}
    </button>
  );
}

function MonthGrid({ days, currentMonth, eventsByDay, onEventClick }: {
  days: Date[];
  currentMonth: Date;
  eventsByDay: Map<string, FounderEvent[]>;
  onEventClick: (ev: FounderEvent) => void;
}) {
  const MAX = 3;
  return (
    <div className="grid grid-cols-7 gap-px bg-gray-100 overflow-hidden rounded-xl border border-gray-100">
      {days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayEvents = eventsByDay.get(key) ?? [];
        const inMonth = isSameMonth(day, currentMonth);
        const today = isToday(day);
        const visible = dayEvents.slice(0, MAX);
        const overflow = dayEvents.length - MAX;
        return (
          <div key={key} className={`flex flex-col bg-white p-1.5 min-h-[90px] ${!inMonth ? "opacity-30" : ""}`}>
            <div className="flex justify-center mb-1">
              <span className={`text-xs font-medium leading-none ${today ? "flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-white" : "text-gray-600"}`}>
                {format(day, "d")}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {visible.map((ev) => <EventChip key={ev.id} ev={ev} onClick={() => onEventClick(ev)} />)}
              {overflow > 0 && (
                <button onClick={() => onEventClick(dayEvents[MAX])} className="text-left px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-600 transition">
                  +{overflow} more
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekGrid({ days, eventsByDay, onEventClick, attendanceByEvent, teamMembers }: {
  days: Date[];
  eventsByDay: Map<string, FounderEvent[]>;
  onEventClick: (ev: FounderEvent) => void;
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  teamMembers: TeamMember[];
}) {
  return (
    <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-xl border border-gray-100 overflow-hidden">
      {days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayEvents = eventsByDay.get(key) ?? [];
        const today = isToday(day);
        return (
          <div key={key} className="flex flex-col bg-white min-h-[200px]">
            <div className={`py-2 text-center border-b border-gray-100 ${today ? "bg-gray-900" : ""}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${today ? "text-gray-300" : "text-gray-400"}`}>{format(day, "EEE")}</p>
              <p className={`text-sm font-bold ${today ? "text-white" : "text-gray-900"}`}>{format(day, "d")}</p>
            </div>
            <div className="flex flex-col gap-1 p-1.5 flex-1">
              {dayEvents.length === 0 && (
                <p className="text-[10px] text-gray-300 text-center mt-4">—</p>
              )}
              {dayEvents.map((ev) => {
                const attendees = attendanceByEvent[ev.id] ?? [];
                const goingMembers = teamMembers.filter((m) => attendees.some((a) => a.memberId === m.id));
                return (
                  <div key={ev.id}>
                    <EventChip ev={ev} onClick={() => onEventClick(ev)} />
                    {goingMembers.length > 0 && (
                      <div className="flex items-center gap-px px-1 mt-0.5">
                        {goingMembers.map((m) => (
                          <div key={m.id} title={m.name}
                            className="h-3 w-3 rounded-full border border-white text-[6px] font-bold text-white flex items-center justify-center"
                            style={{ backgroundColor: m.avatar_color }}>
                            {m.name.charAt(0)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayGrid({ day, eventsByDay, onEventClick, attendanceByEvent, currentIdentity, teamMembers, onToggleAttendance }: {
  day: Date;
  eventsByDay: Map<string, FounderEvent[]>;
  onEventClick: (ev: FounderEvent) => void;
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  currentIdentity: Identity | null;
  teamMembers: TeamMember[];
  onToggleAttendance: (eventId: string) => void;
}) {
  const key = format(day, "yyyy-MM-dd");
  const dayEvents = eventsByDay.get(key) ?? [];
  const today = isToday(day);

  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <div className={`px-5 py-4 border-b border-gray-100 ${today ? "bg-gray-900" : "bg-white"}`}>
        <p className={`text-xs font-semibold uppercase tracking-wider ${today ? "text-gray-400" : "text-gray-400"}`}>{format(day, "EEEE")}</p>
        <p className={`text-2xl font-bold ${today ? "text-white" : "text-gray-900"}`}>{format(day, "d MMMM yyyy")}</p>
      </div>
      {dayEvents.length === 0 ? (
        <div className="bg-white px-5 py-10 text-center">
          <p className="text-sm text-gray-400">No events on this day.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 bg-white">
          {dayEvents.map((ev) => {
            const tier = ev.leadTier ?? "warm";
            const ts = TIER_STYLES[tier];
            let timeStr = "";
            try { timeStr = format(parseISO(ev.date), "h:mm a"); } catch { /* skip */ }
            return (
              <div
                key={ev.id}
                onClick={() => onEventClick(ev)}
                className={`w-full text-left flex items-center gap-4 border-l-2 ${ts.border} px-5 py-4 hover:bg-gray-50 transition cursor-pointer`}
              >
                <div className="w-16 shrink-0 text-right">
                  <p className="text-xs font-semibold text-gray-900">{timeStr}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {tier !== "cold" && (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${ts.labelCls}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${ts.dot}`} />{ts.label}
                      </span>
                    )}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${SOURCE_STYLES[ev.source] ?? ""}`}>
                      {ev.source}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
                  {ev.organizerName && <p className="text-[11px] text-gray-500 truncate">by {ev.organizerName}</p>}
                  {ev.location && <p className="text-xs text-gray-400 mt-0.5 truncate">{ev.location}</p>}
                </div>
                {/* Team circles — always visible */}
                <div onClick={(e) => e.stopPropagation()}>
                  {teamMembers.length > 0 ? (
                    <TeamAttendanceCluster
                      eventId={ev.id}
                      attendanceByEvent={attendanceByEvent}
                      currentIdentity={currentIdentity}
                      teamMembers={teamMembers}
                      onToggle={onToggleAttendance}
                    />
                  ) : (
                    <div className="flex items-center gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-6 w-6 rounded-full border border-dashed border-gray-200 bg-white" />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CalendarView({
  events,
  currentMonth,
  onPrevMonth,
  onNextMonth,
  onAccept,
  onAttend,
  attendanceByEvent,
  currentIdentity,
  teamMembers,
  onToggleAttendance,
}: {
  events: FounderEvent[];
  currentMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onAccept: (dbId: string) => void;
  onAttend: (dbId: string) => void;
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  currentIdentity: Identity | null;
  teamMembers: TeamMember[];
  onToggleAttendance: (eventId: string) => void;
}) {
  const [modalEvent, setModalEvent] = useState<FounderEvent | null>(null);
  const [calMode, setCalMode] = useState<CalendarMode>("month");
  const [focusDate, setFocusDate] = useState<Date>(new Date());

  const goBack = () => {
    if (calMode === "month") onPrevMonth();
    else if (calMode === "week") setFocusDate((d) => subWeeks(d, 1));
    else setFocusDate((d) => subDays(d, 1));
  };
  const goNext = () => {
    if (calMode === "month") onNextMonth();
    else if (calMode === "week") setFocusDate((d) => addWeeks(d, 1));
    else setFocusDate((d) => addDays(d, 1));
  };
  const goToday = () => {
    setFocusDate(new Date());
  };

  const eventsByDay = useMemo(() => buildEventsByDay(events), [events]);

  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }),
  });
  const weekDays = eachDayOfInterval({
    start: startOfWeek(focusDate, { weekStartsOn: 1 }),
    end: endOfWeek(focusDate, { weekStartsOn: 1 }),
  });

  let titleLabel = "";
  if (calMode === "month") titleLabel = format(currentMonth, "MMMM yyyy");
  else if (calMode === "week") {
    const ws = startOfWeek(focusDate, { weekStartsOn: 1 });
    const we = endOfWeek(focusDate, { weekStartsOn: 1 });
    titleLabel = `${format(ws, "d MMM")} – ${format(we, "d MMM yyyy")}`;
  } else {
    titleLabel = format(focusDate, "EEEE, d MMMM yyyy");
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={goBack} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button onClick={goNext} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button onClick={goToday} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition">
            Today
          </button>
          <p className="text-sm font-semibold text-gray-900 ml-1">{titleLabel}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400 inline-block" />Hot</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />Warm</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-300 inline-block" />Cold</span>
          </div>
          <div className="flex items-center gap-px rounded-lg border border-gray-200 bg-white p-0.5">
            {(["day","week","month"] as CalendarMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setCalMode(m)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${calMode === m ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {calMode !== "day" && (
        <div className="grid grid-cols-7 mb-1 border-b border-gray-100 pb-1">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((wd) => (
            <div key={wd} className="py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400">{wd}</div>
          ))}
        </div>
      )}

      {calMode === "month" && (
        <MonthGrid days={monthDays} currentMonth={currentMonth} eventsByDay={eventsByDay} onEventClick={setModalEvent} />
      )}
      {calMode === "week" && (
        <WeekGrid
          days={weekDays}
          eventsByDay={eventsByDay}
          onEventClick={setModalEvent}
          attendanceByEvent={attendanceByEvent}
          teamMembers={teamMembers}
        />
      )}
      {calMode === "day" && (
        <DayGrid
          day={focusDate}
          eventsByDay={eventsByDay}
          onEventClick={setModalEvent}
          attendanceByEvent={attendanceByEvent}
          currentIdentity={currentIdentity}
          teamMembers={teamMembers}
          onToggleAttendance={onToggleAttendance}
        />
      )}

      {modalEvent && (
        <EventDetailModal
          event={modalEvent}
          onClose={() => setModalEvent(null)}
          onAccept={onAccept}
          onAttend={onAttend}
          attendanceByEvent={attendanceByEvent}
          currentIdentity={currentIdentity}
          teamMembers={teamMembers}
          onToggleAttendance={onToggleAttendance}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People view
// ---------------------------------------------------------------------------

function PeopleView({
  teamMembers,
  attendanceByEvent,
  events,
  onEventClick,
}: {
  teamMembers: TeamMember[];
  attendanceByEvent: Record<string, AttendeeInfo[]>;
  events: FounderEvent[];
  onEventClick: (ev: FounderEvent) => void;
}) {
  const now = new Date();

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {teamMembers.map((member) => {
        // Find all upcoming events this member is attending
        const myEventIds = new Set(
          Object.entries(attendanceByEvent)
            .filter(([, attendees]) => attendees.some((a) => a.memberId === member.id))
            .map(([eventId]) => eventId)
        );

        const upcomingEvents = events
          .filter((e) => myEventIds.has(e.id) && new Date(e.date) >= now)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .slice(0, 5);

        return (
          <div key={member.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col items-center gap-2 mb-4">
              <div
                className="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: member.avatar_color }}
              >
                {member.initials}
              </div>
              <p className="text-sm font-semibold text-gray-900">{member.name}</p>
              <p className="text-[11px] text-gray-400">{upcomingEvents.length} upcoming</p>
            </div>

            {upcomingEvents.length === 0 ? (
              <p className="text-[11px] text-gray-300 text-center py-2">No events yet</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {upcomingEvents.map((ev) => {
                  const tier = ev.leadTier ?? "cold";
                  const ts = TIER_STYLES[tier];
                  let dateLabel = "";
                  try { dateLabel = format(parseISO(ev.date), "d MMM"); } catch { /* skip */ }
                  return (
                    <button
                      key={ev.id}
                      onClick={() => onEventClick(ev)}
                      className={`w-full text-left rounded-md border-l-2 ${ts.border} bg-gray-50 px-2 py-1.5 hover:bg-gray-100 transition`}
                    >
                      <p className="text-[10px] font-semibold text-gray-400">{dateLabel}</p>
                      <p className="text-[11px] font-medium text-gray-800 leading-snug line-clamp-2">{ev.title}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organizers view
// ---------------------------------------------------------------------------

type OrganizerFull = OrganizerRow & {
  email?: string | null;
  twitter_url?: string | null;
  events?: Array<{ title: string; url: string; starts_at: string; tier: string }>;
};

function OrganizerTable({ rows }: { rows: OrganizerFull[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 w-8">#</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Person</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 hidden md:table-cell">Organisation</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 hidden sm:table-cell">City</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Events</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 hidden md:table-cell">Contact</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                Hit <strong>Refresh</strong> to scrape events and populate organizers.
              </td>
            </tr>
          )}
          {rows.map((o, idx) => (
            <tr key={o.id ?? o.name} className="hover:bg-gray-50/60 transition group">
              <td className="px-4 py-3 text-xs font-medium text-gray-300 tabular-nums">{idx + 1}</td>
              {/* Person */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {o.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover bg-gray-100 shrink-0 ring-1 ring-gray-200" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-[11px] font-bold text-gray-600 shrink-0">
                      {o.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    {o.luma_profile_url ? (
                      <a href={o.luma_profile_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-semibold text-gray-900 hover:text-indigo-600 transition truncate block max-w-[160px]">
                        {o.name}
                      </a>
                    ) : (
                      <p className="text-sm font-semibold text-gray-900 truncate max-w-[160px]">{o.name}</p>
                    )}
                    {o.username && (
                      <p className="text-[11px] text-gray-400 truncate">@{o.username}</p>
                    )}
                  </div>
                </div>
              </td>
              {/* Organisation */}
              <td className="px-4 py-3 hidden md:table-cell">
                <p className="text-xs text-gray-600 truncate max-w-[160px]">
                  {o.org_name ?? "—"}
                </p>
              </td>
              {/* City */}
              <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell whitespace-nowrap">
                {o.primary_city ?? "—"}
              </td>
              {/* Tier mix + total */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5 flex-nowrap">
                  {o.hot_events > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-red-500 tabular-nums">
                      🔥{o.hot_events}
                    </span>
                  )}
                  {o.warm_events > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-500 tabular-nums">
                      🟡{o.warm_events}
                    </span>
                  )}
                  {o.cold_events > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-400 tabular-nums">
                      🧊{o.cold_events}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-300 tabular-nums ml-0.5">/{o.total_events}</span>
                </div>
              </td>
              {/* Contact */}
              <td className="px-4 py-3 hidden md:table-cell">
                <div className="flex items-center gap-2 flex-wrap">
                  {(o.linkedin_url ?? o.linkedin_handle) && (
                    <a href={o.linkedin_url ?? `https://linkedin.com/in/${o.linkedin_handle}`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
                      LinkedIn
                    </a>
                  )}
                  {o.email && (
                    <a href={`mailto:${o.email}`}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition">
                      Email
                    </a>
                  )}
                  {o.website && (
                    <a href={o.website.startsWith("http") ? o.website : `https://${o.website}`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 transition">
                      Web ↗
                    </a>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrganizersView({
  acceptedEventIds,
}: {
  acceptedEventIds: Set<string>;
}) {
  const [organizers, setOrganizers] = useState<OrganizerFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState<string>("All");
  const [tab, setTab] = useState<"all" | "attended">("all");

  useEffect(() => {
    fetch("/api/organizers")
      .then((r) => r.json())
      .then((d) => setOrganizers(d.organizers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Build sorted city list from data
  const cities = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of organizers) {
      const c = o.primary_city;
      if (c) counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [organizers]);

  const filtered = useMemo(() => {
    let list = organizers;
    if (tab === "attended") {
      list = organizers.filter((o) =>
        (o.events ?? []).some((e) => acceptedEventIds.has(e.url))
      );
    }
    if (cityFilter !== "All") {
      list = list.filter((o) => o.primary_city === cityFilter);
    }
    return list;
  }, [organizers, cityFilter, tab, acceptedEventIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
      </div>
    );
  }

  return (
    <div>
      {/* Tab row */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm w-fit">
          <button onClick={() => setTab("all")}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${tab === "all" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}>
            All organizers
            <span className="ml-1.5 tabular-nums opacity-60">{organizers.length}</span>
          </button>
          <button onClick={() => setTab("attended")}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${tab === "attended" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}>
            Events we attended
          </button>
        </div>
        <span className="text-xs text-gray-400 tabular-nums">{filtered.length} shown</span>
      </div>

      {/* City toggle pills */}
      {cities.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setCityFilter("All")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${cityFilter === "All" ? "bg-gray-900 text-white shadow-sm" : "border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-800 bg-white"}`}
          >
            All cities
          </button>
          {cities.map((c) => (
            <button
              key={c}
              onClick={() => setCityFilter(c === cityFilter ? "All" : c)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${cityFilter === c ? "bg-gray-900 text-white shadow-sm" : "border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-800 bg-white"}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <OrganizerTable rows={filtered} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity Modal ("Who are you?")
// ---------------------------------------------------------------------------

function IdentityModal({
  teamMembers,
  onSelect,
}: {
  teamMembers: TeamMember[];
  onSelect: (member: TeamMember) => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 mb-5 mx-auto overflow-hidden p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/expedite-logo.png" alt="Expedite" className="h-full w-full object-contain" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 text-center mb-1">Who are you?</h2>
        <p className="text-sm text-gray-400 text-center mb-6">Select your profile to track attendance</p>
        <div className="flex flex-col gap-2">
          {teamMembers.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 hover:border-gray-300 transition text-left"
            >
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ backgroundColor: m.avatar_color }}
              >
                {m.initials}
              </div>
              <span className="text-sm font-semibold text-gray-900">{m.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar Setup Modal
// ---------------------------------------------------------------------------

function CalendarSetupModal({ onDone }: { onDone: () => void }) {
  const [googleDone, setGoogleDone] = useState(false);
  const [appleDone, setAppleDone] = useState(false);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-8">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Connect your calendars</h2>
        <p className="text-sm text-gray-400 mb-6">One-time setup to sync events with your calendar apps.</p>

        <div className="flex flex-col gap-3 mb-6">
          <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition">
            <input
              type="checkbox"
              checked={googleDone}
              onChange={(e) => setGoogleDone(e.target.checked)}
              className="h-4 w-4 rounded accent-gray-900"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900">Google Calendar</p>
              <p className="text-[11px] text-gray-400">Mark when you've subscribed</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition">
            <input
              type="checkbox"
              checked={appleDone}
              onChange={(e) => setAppleDone(e.target.checked)}
              className="h-4 w-4 rounded accent-gray-900"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900">Apple Calendar</p>
              <p className="text-[11px] text-gray-400">Mark when you've subscribed</p>
            </div>
          </label>
        </div>

        <button
          onClick={onDone}
          className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 transition"
        >
          Done
        </button>
        <button
          onClick={onDone}
          className="w-full mt-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict Warning Modal
// ---------------------------------------------------------------------------

function ConflictModal({
  otherAttendees,
  onConfirm,
  onCancel,
}: {
  otherAttendees: AttendeeInfo[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const names = otherAttendees.map((a) => a.memberName).join(", ");
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">⚠️</span>
          <h3 className="text-sm font-bold text-gray-900">Already attending</h3>
        </div>
        <p className="text-sm text-gray-600 mb-5">
          <span className="font-semibold">{names}</span> {otherAttendees.length === 1 ? "is" : "are"} already attending this event. Still going?
        </p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 transition"
          >
            Yes, I&apos;m going
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-2xl font-bold tracking-tight text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Home() {
  const [events,      setEvents]      = useState<FounderEvent[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState("All");
  const [tierFilter,  setTierFilter]  = useState("All");
  const [source,      setSource]      = useState("All");
  const [city,        setCity]        = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortByLead,  setSortByLead]  = useState(false);
  const [view,        setView]        = useState<"list" | "calendar" | "people" | "organizers">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [rsvpLoading,  setRsvpLoading]  = useState(false);
  const [rsvpResult,   setRsvpResult]   = useState<{ succeeded: number; failed: number; total: number } | null>(null);
  const [acceptingId,  setAcceptingId]  = useState<string | null>(null);
  const [modalEvent,   setModalEvent]   = useState<FounderEvent | null>(null);

  // Identity / team
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [showCalendarSetup, setShowCalendarSetup] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [attendanceByEvent, setAttendanceByEvent] = useState<Record<string, AttendeeInfo[]>>({});

  // Conflict warning
  const [conflictPending, setConflictPending] = useState<{ eventId: string; others: AttendeeInfo[] } | null>(null);

  // Load identity from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("expedite_identity");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Identity;
        setIdentity(parsed);
      } catch { /* ignore */ }
    }
  }, []);

  // Load team members
  useEffect(() => {
    fetch("/api/team")
      .then((r) => r.json())
      .then((d) => {
        const members: TeamMember[] = d.members ?? [];
        setTeamMembers(members);
        // If no identity yet, show the modal once members are loaded
        if (!identity && members.length > 0) {
          const stored = localStorage.getItem("expedite_identity");
          if (!stored) setShowIdentityModal(true);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load all attendance on page load
  useEffect(() => {
    fetch("/api/attendance")
      .then((r) => r.json())
      .then((d) => setAttendanceByEvent(d.attendanceByEvent ?? {}))
      .catch(() => {});
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/events");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, []);

  const rsvpFiltered = useCallback(async (eventIds: string[]) => {
    if (eventIds.length === 0) return;
    setRsvpLoading(true);
    setRsvpResult(null);
    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventIds }),
      });
      const data = await res.json();
      setRsvpResult(data.summary);
    } catch {
      setRsvpResult({ succeeded: 0, failed: 0, total: 0 });
    } finally {
      setRsvpLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleAccept = useCallback(async (dbId: string) => {
    setAcceptingId(dbId);
    try {
      const res = await fetch("/api/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dbId }),
      });
      if (!res.ok) return;

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "event.ics";
      a.click();
      URL.revokeObjectURL(url);

      setEvents((prev) =>
        prev.map((e) => e.dbId === dbId ? { ...e, acceptedAt: new Date().toISOString() } : e)
      );
    } finally {
      setAcceptingId(null);
    }
  }, []);

  const handleAttend = useCallback(async (dbId: string) => {
    await fetch("/api/attend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dbId }),
    });
    setEvents((prev) =>
      prev.map((e) => e.dbId === dbId ? { ...e, attendedAt: new Date().toISOString() } : e)
    );
  }, []);

  // Toggle team attendance
  const doToggleAttendance = useCallback(async (eventId: string) => {
    if (!identity) return;
    const attendees = attendanceByEvent[eventId] ?? [];
    const myAttendance = attendees.find((a) => a.memberId === identity.teamMemberId);

    if (myAttendance) {
      // Remove attendance
      await fetch("/api/attendance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_external_id: eventId, team_member_id: identity.teamMemberId }),
      });
      setAttendanceByEvent((prev) => ({
        ...prev,
        [eventId]: (prev[eventId] ?? []).filter((a) => a.memberId !== identity.teamMemberId),
      }));
    } else {
      // Add attendance
      await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_external_id: eventId, team_member_id: identity.teamMemberId, status: "going" }),
      });
      setAttendanceByEvent((prev) => ({
        ...prev,
        [eventId]: [
          ...(prev[eventId] ?? []),
          {
            attendanceId: "",
            memberId: identity.teamMemberId,
            memberName: identity.name,
            initials: identity.initials,
            avatarColor: identity.avatarColor,
            status: "going",
          },
        ],
      }));
    }
  }, [identity, attendanceByEvent]);

  const handleToggleAttendance = useCallback((eventId: string) => {
    if (!identity) return;
    const noConflictWarning = typeof window !== "undefined" && localStorage.getItem("expedite_no_conflict_warning") === "true";
    const attendees = attendanceByEvent[eventId] ?? [];
    const myAttendance = attendees.find((a) => a.memberId === identity.teamMemberId);

    if (!myAttendance) {
      // Adding attendance — check for conflicts
      const otherAttendees = attendees.filter((a) => a.memberId !== identity.teamMemberId && a.status === "going");
      if (otherAttendees.length > 0 && !noConflictWarning) {
        setConflictPending({ eventId, others: otherAttendees });
        return;
      }
    }
    doToggleAttendance(eventId);
  }, [identity, attendanceByEvent, doToggleAttendance]);

  const handleIdentitySelect = useCallback((member: TeamMember) => {
    const newIdentity: Identity = {
      teamMemberId: member.id,
      name: member.name,
      initials: member.initials,
      avatarColor: member.avatar_color,
      calendarSetupDone: member.calendar_setup_done,
    };
    setIdentity(newIdentity);
    localStorage.setItem("expedite_identity", JSON.stringify(newIdentity));
    setShowIdentityModal(false);
    if (!member.calendar_setup_done) {
      setShowCalendarSetup(true);
    }
  }, []);

  const handleCalendarSetupDone = useCallback(() => {
    setShowCalendarSetup(false);
    if (identity) {
      const updated = { ...identity, calendarSetupDone: true };
      setIdentity(updated);
      localStorage.setItem("expedite_identity", JSON.stringify(updated));
    }
  }, [identity]);

  const availableCities = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((ev) => {
      const c = extractCity(ev.location);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c)
      .filter((c) => c !== "Other");
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return events.filter((ev) => {
      const tierOk = tierFilter === "All" || ev.leadTier === tierFilter;
      const catOk  = activeTab  === "All" || ev.category.toLowerCase() === activeTab.toLowerCase();
      const srcOk  = source     === "All"
        || (source === "Other" && OTHER_SOURCES.has(ev.source))
        || ev.source.toLowerCase() === source.toLowerCase();
      const cityOk = city       === "All" || extractCity(ev.location)  === city;
      const searchOk = !q || ev.title.toLowerCase().includes(q)
        || ev.description.toLowerCase().includes(q)
        || ev.location.toLowerCase().includes(q)
        || (ev.organizerName ?? "").toLowerCase().includes(q);
      return tierOk && catOk && srcOk && cityOk && searchOk;
    });
  }, [events, activeTab, tierFilter, source, city, searchQuery]);

  const sortedEvents = useMemo(() => {
    const arr = [...filteredEvents];
    return sortByLead
      ? arr.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0))
      : arr.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [filteredEvents, sortByLead]);

  const hotCount   = events.filter((e) => e.leadTier === "hot").length;
  const warmCount  = events.filter((e) => e.leadTier === "warm").length;
  const coldCount  = events.filter((e) => e.leadTier === "cold").length;
  const now        = new Date();
  const nextHotEvent = [...events]
    .filter((e) => e.leadTier === "hot" && new Date(e.date) > now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

  const isOrganizersView = view === "organizers";
  const isPeopleView = view === "people";

  return (
    <div className="min-h-screen bg-[#fafafa] font-sans antialiased">

      {/* Modals */}
      {showIdentityModal && (
        <IdentityModal teamMembers={teamMembers.length > 0 ? teamMembers : DEFAULT_TEAM} onSelect={handleIdentitySelect} />
      )}
      {showCalendarSetup && !showIdentityModal && (
        <CalendarSetupModal onDone={handleCalendarSetupDone} />
      )}
      {conflictPending && (
        <ConflictModal
          otherAttendees={conflictPending.others}
          onConfirm={() => {
            doToggleAttendance(conflictPending.eventId);
            setConflictPending(null);
          }}
          onCancel={() => setConflictPending(null)}
        />
      )}
      {modalEvent && (
        <EventDetailModal
          event={modalEvent}
          onClose={() => setModalEvent(null)}
          onAccept={handleAccept}
          onAttend={handleAttend}
          attendanceByEvent={attendanceByEvent}
          currentIdentity={identity}
          teamMembers={teamMembers}
          onToggleAttendance={handleToggleAttendance}
        />
      )}

      {/* ── Top nav ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 overflow-hidden p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/expedite-logo.png" alt="Expedite" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-semibold text-gray-900">Expedite Events</span>
            <span className="hidden text-gray-200 sm:inline">·</span>
            <span className="hidden text-xs text-gray-400 sm:inline">Founder pipeline</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Subscribe in Apple Calendar */}
            <a
              href="webcal://localhost:3000/api/calendar"
              title="Subscribe to your accepted events in Apple Calendar"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <span className="hidden sm:inline">Subscribe</span>
            </a>
            <button
              onClick={fetchEvents}
              disabled={loading}
              title="Re-scrape all sources and refresh the event list"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-40"
            >
              <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Refresh
            </button>
            <button
              onClick={() => rsvpFiltered(sortedEvents.map((e) => e.id))}
              disabled={rsvpLoading || loading || sortedEvents.length === 0}
              title={`RSVP to ${sortedEvents.length} events matching your current filters`}
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-700 disabled:opacity-40"
            >
              {rsvpLoading ? "RSVPing…" : `RSVP Filtered (${sortedEvents.length})`}
            </button>

            {/* Identity avatar */}
            {identity ? (
              <button
                onClick={() => setShowIdentityModal(true)}
                title={`Signed in as ${identity.name} — click to switch`}
                style={{ backgroundColor: identity.avatarColor }}
                className="h-8 w-8 rounded-full flex items-center justify-center text-white font-bold text-xs ring-2 ring-white hover:ring-gray-300 transition shrink-0"
              >
                {identity.initials}
              </button>
            ) : (
              <button
                onClick={() => setShowIdentityModal(true)}
                className="h-8 w-8 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-gray-400 transition text-xs"
                title="Set your identity"
              >
                ?
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">

        {/* ── Stats row ─────────────────────────────────────────── */}
        {!loading && !error && (
          <div className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-5">
            <Stat label="Total events"  value={events.length} />
            <Stat label="🔥 Hot"       value={hotCount}  sub="Highest founder density" />
            <Stat label="🟡 Warm"      value={warmCount} sub="Strong founder signal" />
            <Stat label="🧊 Cold"      value={coldCount} sub="Broader tech ecosystem" />
            <Stat label="Next 🔥 Hot"
              value={nextHotEvent ? format(parseISO(nextHotEvent.date), "d MMM") : "—"}
              sub={nextHotEvent ? truncate(nextHotEvent.title, 28) : "No upcoming hot events"}
            />
          </div>
        )}

        {/* ── RSVP result ───────────────────────────────────────── */}
        {rsvpResult && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <span className={`h-2 w-2 rounded-full ${rsvpResult.succeeded > 0 ? "bg-green-500" : "bg-amber-400"}`} />
            <p className="text-sm text-gray-700">
              <span className="font-semibold">{rsvpResult.succeeded}</span> RSVPs succeeded ·{" "}
              <span className="font-semibold">{rsvpResult.failed}</span> failed ·{" "}
              <span className="font-semibold">{rsvpResult.total}</span> total
            </p>
          </div>
        )}

        {/* ── View toggles ──────────────────────────────────────── */}
        <div className="mb-4 flex flex-col gap-2" suppressHydrationWarning>
          {/* Row 1: Event views */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 w-16 shrink-0">Events</span>
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setView("calendar")}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  view === "calendar" ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                Calendar
              </button>
              <button
                onClick={() => setView("list")}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  view === "list" ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                List
              </button>
            </div>
          </div>

          {/* Row 2: People context — who's hosting vs who's attending */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 w-16 shrink-0">People</span>
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setView("organizers")}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  view === "organizers" ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                Organizers
                <span className="text-[10px] text-gray-400 font-normal">hosting</span>
              </button>
              <button
                onClick={() => setView("people")}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  view === "people" ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                Team
                <span className="text-[10px] text-gray-400 font-normal">attending</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Toolbar (hidden for people/organizers views) ────── */}
        {!isPeopleView && !isOrganizersView && (
          <div className="mb-5 flex flex-col gap-3">
            {/* Search bar */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                placeholder="Search events… e.g. Anthropic, Granola, YC, Berlin hackathon"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-10 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Row 1: Tier filter + sort */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mr-1">Tier</span>
                {TIER_TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setTierFilter(id)}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                      tierFilter === id
                        ? id === "All"  ? "border-gray-900 bg-gray-900 text-white"
                          : id === "hot"  ? "border-red-500 bg-red-500 text-white"
                          : id === "warm" ? "border-amber-400 bg-amber-400 text-white"
                          : "border-blue-400 bg-blue-400 text-white"
                        : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    }`}
                  >
                    {label}
                    {id !== "All" && (
                      <span className="ml-1.5 tabular-nums opacity-75">
                        {events.filter(e => e.leadTier === id).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {view === "list" && (
                <button
                  onClick={() => setSortByLead((v) => !v)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium shadow-sm transition shrink-0 ${
                    sortByLead ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  Best leads first
                </button>
              )}
            </div>

            {/* Row 2: Category tabs */}
            <div className="flex items-center gap-px overflow-x-auto rounded-lg border border-gray-200 bg-white p-1 shadow-sm w-fit">
              {CATEGORY_TABS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    activeTab === id ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Row 2: Source tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mr-1 shrink-0">Source</span>
              {SOURCE_TABS.map(({ id, label }) => {
                const srcKey = id.toLowerCase();
                const style = SOURCE_STYLES[srcKey];
                const isActive = source === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSource(id)}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                      isActive
                        ? id === "All"
                          ? "border-gray-900 bg-gray-900 text-white"
                          : `${style} border-transparent ring-1`
                        : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    }`}
                  >
                    {label}
                    {id !== "All" && (
                      <span className="ml-1.5 tabular-nums opacity-60">
                        {id === "Other"
                          ? events.filter((e) => OTHER_SOURCES.has(e.source)).length
                          : events.filter((e) => e.source.toLowerCase() === srcKey).length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Row 3: City filter */}
            {availableCities.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mr-1 shrink-0">City</span>
                <button
                  onClick={() => setCity("All")}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                    city === "All"
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                >
                  All cities
                </button>
                {availableCities.map((c) => {
                  const count = events.filter((e) => extractCity(e.location) === c).length;
                  const isActive = city === c;
                  return (
                    <button
                      key={c}
                      onClick={() => setCity(c)}
                      className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                        isActive
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
                      }`}
                    >
                      {c}
                      <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Content ───────────────────────────────────────────── */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
            <p className="mt-4 text-xs text-gray-400">Fetching events…</p>
          </div>

        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-6 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button onClick={fetchEvents} className="mt-3 rounded-md border border-red-200 bg-white px-4 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50">
              Retry
            </button>
          </div>

        ) : view === "organizers" ? (
          <OrganizersView
            acceptedEventIds={new Set(events.filter(e => e.acceptedAt).map(e => e.url))}
          />

        ) : view === "people" ? (
          <PeopleView
            teamMembers={teamMembers}
            attendanceByEvent={attendanceByEvent}
            events={events}
            onEventClick={(ev) => setModalEvent(ev)}
          />

        ) : view === "calendar" ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <CalendarView
              events={filteredEvents}
              currentMonth={currentMonth}
              onPrevMonth={() => setCurrentMonth((m) => subMonths(m, 1))}
              onNextMonth={() => setCurrentMonth((m) => addMonths(m, 1))}
              onAccept={handleAccept}
              onAttend={handleAttend}
              attendanceByEvent={attendanceByEvent}
              currentIdentity={identity}
              teamMembers={teamMembers}
              onToggleAttendance={handleToggleAttendance}
            />
          </div>

        ) : sortedEvents.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-sm font-medium text-gray-900">No events found</p>
            <p className="mt-1 text-xs text-gray-400">Try a different filter or refresh.</p>
          </div>

        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="text-xs font-medium text-gray-400">
                {sortedEvents.length} event{sortedEvents.length !== 1 && "s"}
                {activeTab !== "All" && ` · ${activeTab}`}
              </p>
              <p className="text-xs text-gray-300">sorted by {sortByLead ? "lead quality" : "date"}</p>
            </div>
            <div className="divide-y divide-gray-100">
              {sortedEvents.map((ev) => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  onAccept={handleAccept}
                  onAttend={handleAttend}
                  onOpen={(event) => setModalEvent(event)}
                  attendanceByEvent={attendanceByEvent}
                  currentIdentity={identity}
                  teamMembers={teamMembers}
                  onToggleAttendance={handleToggleAttendance}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="mt-16 border-t border-gray-100 py-6">
        <p className="text-center text-[11px] text-gray-300">
          Expedite Events · London founder pipeline · auto-refreshes daily at 08:00 UTC
        </p>
      </footer>
    </div>
  );
}
