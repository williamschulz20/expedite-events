import { scoreLeadQuality, type FounderEvent } from "@/lib/types";
import { letterFor, type GradeSummary } from "@/lib/grade";

// ---------------------------------------------------------------------------
// Read-time scoring context and data hygiene.
//
// scoreLeadQuality() reads one listing in isolation, so it is easy to fool: a
// seminar company running the same "STARTUP FUNDRAISING STRATEGY SESSION" in
// eight hotel ballrooms scores like a demo day, and a visa seller scores like
// a founder who needs a visa. Some of what gives those away is only visible
// across the whole dataset (the same title in many cities), and the best
// signal of all, how the team graded a past edition, only exists after
// someone went. Both are applied here, at read time, so every event is
// re-judged on today's knowledge rather than whatever was true when it was
// scraped.
// ---------------------------------------------------------------------------

export type Tier = "hot" | "warm" | "cold";

export interface ScoreAdjustment {
  delta: number;
  reason: string;
}

/** What the team's past grades say about a series or an organizer. */
export interface GradeSignal {
  /** Mean grade, 0 to 100. */
  score: number;
  count: number;
}

export interface Feedback {
  bySeries: Map<string, GradeSignal>;
  byOrganizer: Map<string, GradeSignal>;
}

export const EMPTY_FEEDBACK: Feedback = { bySeries: new Map(), byOrganizer: new Map() };

export type RadarEvent = FounderEvent & {
  /** The listing-only score, before context and feedback. */
  baseScore?: number;
  adjustments?: ScoreAdjustment[];
  /** False when the source gave a date but no start time. */
  timeKnown?: boolean;
  lastSeenAt?: string;
  /** Not seen by any scraper recently: may have been cancelled or changed. */
  stale?: boolean;
  seriesKey?: string;
  /** The team's grade, once someone who went has graded it. */
  grade?: GradeSummary;
};

export function tierFor(score: number): Tier {
  return score >= 80 ? "hot" : score >= 55 ? "warm" : "cold";
}

// ---- keys -----------------------------------------------------------------

const CITY_WORDS = [
  "london", "berlin", "paris", "amsterdam", "san francisco", "sf", "munich", "barcelona",
  "zurich", "stockholm", "helsinki", "lisbon", "dublin", "copenhagen", "milan", "madrid",
  "istanbul", "vienna", "warsaw", "brussels", "hamburg", "budapest", "prague", "geneva",
  "rome", "los angeles", "la", "new york", "nyc", "austin", "boston", "oslo", "tallinn",
  "riga", "seattle", "chicago", "miami", "toronto", "vancouver", "denver", "atlanta",
  "dallas", "houston", "san diego", "san jose", "palo alto", "silicon valley", "bay area",
  "washington", "dc", "philadelphia", "manchester", "edinburgh", "singapore", "dubai",
];
const CITY_RE = new RegExp(`\\b(${CITY_WORDS.map((c) => c.replace(/ /g, "\\s+")).join("|")})\\b`, "g");

function words(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A title with the parts that change between editions removed (years, dates,
 * numbers, city names), so "Founders Pitch Night London 2026" and "Founders
 * Pitch Night - Berlin" share one key. Used to spot touring series and to
 * carry a grade from one edition to the next.
 */
export function seriesKey(title: string): string {
  return words(title)
    .replace(CITY_RE, " ")
    .replace(/\b(in|at|by|the|a|an|and|of|for|with|edition|vol|ep)\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)?\b/g, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ");
}

export function organizerKey(name: string | null | undefined): string {
  return name ? words(name) : "";
}

/** The city from the venue, or from the title when the venue is just a name. */
function cityOf(location: string, title: string): string {
  const m = words(location ?? "").match(CITY_RE) ?? words(title ?? "").match(CITY_RE);
  return m ? m[0] : "";
}

// ---- context rules --------------------------------------------------------

// Companies selling visas, relocation or residency. They run events that read
// like ours and are full of other sellers.
const SELLER_RE =
  /\b(blue card|golden visa|eb ?5|citizenship by investment|residency by investment|study abroad|visa (program|programme|seminar|webinar|consultation|workshop|info session)|immigration (seminar|webinar|consultation|workshop|info session)|relocation (program|programme|package|service)|work permit (program|programme)|techrabo)\b/;

// Paid-seminar formats: someone is selling a course, not hosting founders.
const SEMINAR_RE =
  /\b(strategy session|masterclass|master class|bootcamp|blueprint|one day (training|workshop)|1 day (training|workshop)|training program|certification|seminar|success summit|wealth|get rich|passive income|real estate investing)\b/;

const BIG_VENUE_RE =
  /\b(hotel|marriott|hilton|hyatt|fairmont|sheraton|westin|intercontinental|driskill|ritz|convention (center|centre)|exhibition (center|centre)|expo (center|centre))\b/;

/** Same title in at least this many cities reads as a commercial tour. */
const TOURING_CITY_THRESHOLD = 3;

// Touring alone is not the tell: DevOpsDays and Startup Weekend run in dozens
// of cities and are the real thing. The commercial tours are generic
// "networking & pitch night" formats sold city by city.
const GENERIC_TOUR_RE = /\b(networking|pitch night|pitch event|pitch and networking|mixer|happy hour|fundraising|investor connect|startup pitch|founders pitch|business networking)\b/;
const COMMUNITY_FRANCHISE_RE = /\b(devopsdays|devops days|startup weekend|startup grind|techstars|founders running club|pydata|gdg|google developer|aws community day|bsides|wordcamp|hacker news|indie hackers|product hunt|on deck)\b/;

function shouting(title: string): boolean {
  const letters = title.replace(/[^A-Za-z]/g, "");
  return letters.length >= 12 && letters === letters.toUpperCase();
}

function gradeDelta(signal: GradeSignal): number {
  // A graded "A" edition (90) lifts the next one by up to 20; an "F" sinks it.
  // One grade counts for half, two or more for the full weight.
  const weight = signal.count >= 2 ? 1 : 0.5;
  return Math.round(Math.max(-20, Math.min(20, ((signal.score - 50) / 2) * weight)));
}

/**
 * Re-scores every event from its listing, then applies the cross-listing rules
 * and the team's grades. Mutates nothing; returns new objects.
 */
export function applyContext(events: RadarEvent[], feedback: Feedback = EMPTY_FEEDBACK): RadarEvent[] {
  // Which cities each series appears in.
  const citiesBySeries = new Map<string, Set<string>>();
  const keys = events.map((e) => seriesKey(e.title ?? ""));
  events.forEach((e, i) => {
    const city = cityOf(e.location, e.title);
    if (!keys[i] || !city) return;
    const set = citiesBySeries.get(keys[i]) ?? new Set<string>();
    set.add(city);
    citiesBySeries.set(keys[i], set);
  });

  return events.map((e, i) => {
    const base = scoreLeadQuality(e.title ?? "", e.description ?? "");
    const text = words(`${e.title} ${e.description ?? ""}`);
    const adjustments: ScoreAdjustment[] = [];

    if (base.score > 0) {
      if (SELLER_RE.test(text)) {
        adjustments.push({ delta: -40, reason: "Run by a visa or relocation seller: the room is other sellers, not founders" });
      }
      const seminar = SEMINAR_RE.test(text);
      const bigVenue = BIG_VENUE_RE.test(words(e.location ?? ""));
      if (seminar && (bigVenue || shouting(e.title ?? ""))) {
        adjustments.push({ delta: -30, reason: "Paid seminar format in a hotel or expo venue: someone is selling a course" });
      } else if (seminar) {
        adjustments.push({ delta: -12, reason: "Seminar / course format rather than founders meeting each other" });
      }
      const cities = citiesBySeries.get(keys[i])?.size ?? 0;
      const title = words(e.title ?? "");
      if (cities >= TOURING_CITY_THRESHOLD && GENERIC_TOUR_RE.test(title) && !COMMUNITY_FRANCHISE_RE.test(title)) {
        adjustments.push({ delta: -25, reason: `Same event touring ${cities} cities: a commercial series, not a local founder community` });
      }
    }

    const series = keys[i] ? feedback.bySeries.get(keys[i]) : undefined;
    if (series) {
      adjustments.push({
        delta: gradeDelta(series),
        reason: `Team graded a past edition ${letterFor(series.score)} (${series.count} ${series.count === 1 ? "grade" : "grades"})`,
      });
    } else {
      const org = feedback.byOrganizer.get(organizerKey(e.organizerName));
      if (org) {
        adjustments.push({
          delta: gradeDelta(org),
          reason: `Team graded this organizer's events ${letterFor(org.score)} (${org.count} ${org.count === 1 ? "grade" : "grades"})`,
        });
      }
    }

    const nonZero = adjustments.filter((a) => a.delta !== 0);
    const score = Math.max(0, Math.min(100, base.score + nonZero.reduce((sum, a) => sum + a.delta, 0)));
    const penalised = nonZero.some((a) => a.delta < 0);
    return {
      ...e,
      baseScore: base.score,
      adjustments: nonZero,
      leadScore: score,
      leadTier: tierFor(score),
      highLeverage: score >= 80 || (base.highLeverage && !penalised),
      leverageReason: base.leverageReason || undefined,
      seriesKey: keys[i],
    };
  });
}

// ---- hygiene --------------------------------------------------------------

/** Days without a scraper seeing an event before it counts as stale. */
export const STALE_AFTER_DAYS = 10;

/**
 * Sources that give a date with no time store midnight UTC, which reads as a
 * real 00:00 or 01:00 start. Treat exactly-midnight UTC as "time unknown".
 */
export function timeKnown(iso: string | undefined): boolean {
  if (!iso) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return !/T00:00(:00(\.0+)?)?(Z|\+00:?00)?$/.test(iso);
}

export function isStale(lastSeenAt: string | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && now - seen > STALE_AFTER_DAYS * 86_400_000;
}

// Richer sources first when the same event is listed twice.
const SOURCE_RANK = ["luma", "partiful", "meetup", "garysguide", "conference", "confstech", "eventbrite", "devevents", "startupgrind", "selectusa", "websearch"];

function richness(e: RadarEvent): number {
  const rank = SOURCE_RANK.indexOf(e.source);
  return (
    (e.organizerName ? 8 : 0) +
    (timeKnown(e.date) ? 4 : 0) +
    (e.stale ? 0 : 4) +
    (rank === -1 ? 0 : (SOURCE_RANK.length - rank) / SOURCE_RANK.length) +
    Math.min(1, (e.description?.length ?? 0) / 500)
  );
}

/**
 * One row per real event. Keyed on the normalised title and day, so the same
 * event from two scrapers (or under two ids from one) collapses to the
 * richest listing, keeping any team state either copy carried.
 */
export function dedupeEvents(events: RadarEvent[]): RadarEvent[] {
  const best = new Map<string, RadarEvent>();
  for (const e of events) {
    const key = `${words(e.title ?? "").slice(0, 80)}|${(e.date ?? "").slice(0, 10)}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, e);
      continue;
    }
    const [keep, drop] = richness(e) > richness(current) ? [e, current] : [current, e];
    best.set(key, {
      ...keep,
      acceptedAt: keep.acceptedAt ?? drop.acceptedAt,
      attendedAt: keep.attendedAt ?? drop.attendedAt,
      cost: keep.cost ?? drop.cost,
      debriefNotes: keep.debriefNotes ?? drop.debriefNotes,
    });
  }
  return [...best.values()];
}

/** Hygiene flags for one stored event. */
export function withHygiene(e: RadarEvent, now = Date.now()): RadarEvent {
  return { ...e, timeKnown: timeKnown(e.date), stale: isStale(e.lastSeenAt, now) };
}
