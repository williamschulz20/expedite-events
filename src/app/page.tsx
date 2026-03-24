"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
} from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FounderEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  endDate?: string;
  location: string;
  url: string;
  source: "eventbrite" | "luma" | "partiful";
  category: string;
  imageUrl?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "All",
  "Hackathon",
  "Demo Day",
  "Pitch",
  "Networking",
  "Fundraising",
  "Accelerator",
  "Immigration",
] as const;

const SOURCES = ["All", "Eventbrite", "Luma", "Partiful"] as const;

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  eventbrite: { bg: "bg-orange-100", text: "text-orange-700" },
  luma: { bg: "bg-purple-100", text: "text-purple-700" },
  partiful: { bg: "bg-pink-100", text: "text-pink-700" },
};

const CATEGORY_COLORS: Record<string, string> = {
  hackathon: "bg-blue-100 text-blue-700",
  "demo day": "bg-emerald-100 text-emerald-700",
  pitch: "bg-amber-100 text-amber-700",
  networking: "bg-cyan-100 text-cyan-700",
  fundraising: "bg-green-100 text-green-700",
  accelerator: "bg-violet-100 text-violet-700",
  immigration: "bg-red-100 text-red-700",
};

const SOURCE_DOT_COLORS: Record<string, string> = {
  eventbrite: "bg-orange-500",
  luma: "bg-purple-500",
  partiful: "bg-pink-500",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str: string, max: number) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: string }) {
  const colors = SOURCE_COLORS[source] ?? { bg: "bg-gray-100", text: "text-gray-700" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
    >
      {source.charAt(0).toUpperCase() + source.slice(1)}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category.toLowerCase()] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors}`}
    >
      {category}
    </span>
  );
}

function EventCard({ event }: { event: FounderEvent }) {
  const date = parseISO(event.date);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 leading-tight">
            {event.title}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1">
              <CalendarIcon />
              {format(date, "EEE, MMM d, yyyy")}
              {" at "}
              {format(date, "h:mm a")}
            </span>
          </div>

          {event.location && (
            <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
              <MapPinIcon />
              {event.location}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <SourceBadge source={event.source} />
            <CategoryBadge category={event.category} />
          </div>

          {event.description && (
            <p className="mt-3 text-sm text-gray-600 leading-relaxed">
              {truncate(event.description, 160)}
            </p>
          )}
        </div>

        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700 sm:mt-0"
        >
          RSVP
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (no dependency needed)
// ---------------------------------------------------------------------------

function CalendarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
      />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Calendar View
// ---------------------------------------------------------------------------

function CalendarView({
  events,
  currentMonth,
  onPrevMonth,
  onNextMonth,
  selectedDay,
  onSelectDay,
}: {
  events: FounderEvent[];
  currentMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  selectedDay: Date | null;
  onSelectDay: (day: Date) => void;
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const eventsByDay = useMemo(() => {
    const map = new Map<string, FounderEvent[]>();
    events.forEach((ev) => {
      const key = format(parseISO(ev.date), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    });
    return map;
  }, [events]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDay) return [];
    const key = format(selectedDay, "yyyy-MM-dd");
    return eventsByDay.get(key) ?? [];
  }, [selectedDay, eventsByDay]);

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onPrevMonth}
          className="rounded-lg p-2 hover:bg-gray-100 transition"
          aria-label="Previous month"
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-lg font-semibold text-gray-900">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <button
          onClick={onNextMonth}
          className="rounded-lg p-2 hover:bg-gray-100 transition"
          aria-label="Next month"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {weekdays.map((wd) => (
          <div
            key={wd}
            className="py-2 text-center text-xs font-medium text-gray-400 uppercase tracking-wider"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, currentMonth);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const isToday = isSameDay(day, new Date());

          return (
            <button
              key={key}
              onClick={() => onSelectDay(day)}
              className={`
                relative flex flex-col items-center justify-start bg-white p-2 min-h-[72px] transition
                ${!inMonth ? "text-gray-300" : "text-gray-700"}
                ${isSelected ? "ring-2 ring-inset ring-gray-900" : ""}
                ${isToday && !isSelected ? "bg-gray-50" : ""}
                hover:bg-gray-50
              `}
            >
              <span
                className={`text-sm font-medium ${
                  isToday
                    ? "flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-white"
                    : ""
                }`}
              >
                {format(day, "d")}
              </span>
              {dayEvents.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-center gap-0.5">
                  {dayEvents.slice(0, 4).map((ev) => (
                    <span
                      key={ev.id}
                      className={`block h-1.5 w-1.5 rounded-full ${
                        SOURCE_DOT_COLORS[ev.source] ?? "bg-gray-400"
                      }`}
                    />
                  ))}
                  {dayEvents.length > 4 && (
                    <span className="text-[10px] text-gray-400 leading-none">
                      +{dayEvents.length - 4}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day panel */}
      {selectedDay && (
        <div className="mt-6">
          <h3 className="text-base font-semibold text-gray-900 mb-3">
            Events on {format(selectedDay, "EEEE, MMMM d")}
          </h3>
          {selectedDayEvents.length === 0 ? (
            <p className="text-sm text-gray-500">No events on this day.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedDayEvents.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Home() {
  const [events, setEvents] = useState<FounderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSource, setSelectedSource] = useState("All");

  // View
  const [view, setView] = useState<"list" | "calendar">("list");

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [rsvpResult, setRsvpResult] = useState<{ succeeded: number; failed: number; total: number } | null>(null);

  // Fetch events
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/events");
      if (!res.ok) throw new Error(`Failed to fetch events (${res.status})`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  const rsvpAll = useCallback(async () => {
    setRsvpLoading(true);
    setRsvpResult(null);
    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rsvpAll: true }),
      });
      const data = await res.json();
      setRsvpResult(data.summary);
    } catch {
      setRsvpResult({ succeeded: 0, failed: 0, total: 0 });
    } finally {
      setRsvpLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const categoryMatch =
        selectedCategory === "All" ||
        ev.category.toLowerCase() === selectedCategory.toLowerCase();
      const sourceMatch =
        selectedSource === "All" ||
        ev.source.toLowerCase() === selectedSource.toLowerCase();
      return categoryMatch && sourceMatch;
    });
  }, [events, selectedCategory, selectedSource]);

  // Sort by date for list view
  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [filteredEvents]);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                Expedite Events
              </h1>
              <p className="mt-1 text-base text-gray-500">
                Founder events in London &mdash; hackathons, demo days, pitch
                nights &amp; more
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={rsvpAll}
                disabled={rsvpLoading || loading}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:opacity-50"
              >
                {rsvpLoading ? "RSVPing..." : "RSVP All"}
              </button>
              <button
                onClick={fetchEvents}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
              >
                <span className={loading ? "animate-spin" : ""}>
                  <RefreshIcon />
                </span>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* RSVP Result Banner */}
      {rsvpResult && (
        <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 lg:px-8">
          <div className={`rounded-lg p-4 ${rsvpResult.succeeded > 0 ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"}`}>
            <p className={`text-sm font-medium ${rsvpResult.succeeded > 0 ? "text-green-800" : "text-amber-800"}`}>
              RSVP complete: {rsvpResult.succeeded} succeeded, {rsvpResult.failed} failed out of {rsvpResult.total} events
            </p>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Filters + View Toggle */}
        <div className="space-y-4 mb-8">
          {/* Category filters */}
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Category
            </p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    selectedCategory === cat
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Source filters + view toggle */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Source
              </p>
              <div className="flex flex-wrap gap-2">
                {SOURCES.map((src) => (
                  <button
                    key={src}
                    onClick={() => setSelectedSource(src)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                      selectedSource === src
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {src}
                  </button>
                ))}
              </div>
            </div>

            {/* View toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 self-start sm:self-auto">
              <button
                onClick={() => setView("list")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  view === "list"
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <ListIcon />
                List
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  view === "calendar"
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <GridIcon />
                Calendar
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            <p className="mt-4 text-sm text-gray-500">Loading events...</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm font-medium text-red-800">{error}</p>
            <button
              onClick={fetchEvents}
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-800 transition hover:bg-red-200"
            >
              Try again
            </button>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-lg font-medium text-gray-900">No events found</p>
            <p className="mt-1 text-sm text-gray-500">
              Try adjusting your filters or check back later.
            </p>
          </div>
        ) : view === "list" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-500">
              {filteredEvents.length} event{filteredEvents.length !== 1 && "s"}
            </p>
            {sortedEvents.map((ev) => (
              <EventCard key={ev.id} event={ev} />
            ))}
          </div>
        ) : (
          <CalendarView
            events={filteredEvents}
            currentMonth={currentMonth}
            onPrevMonth={() => setCurrentMonth((m) => subMonths(m, 1))}
            onNextMonth={() => setCurrentMonth((m) => addMonths(m, 1))}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-100 py-6">
        <p className="text-center text-xs text-gray-400">
          Expedite Events &middot; Built for founders
        </p>
      </footer>
    </div>
  );
}
