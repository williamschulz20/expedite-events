// ---------------------------------------------------------------------------
// Event Analytics — Weekly attendance and lead quality reporting
//
// Aggregates event data to show:
//   - Events attended vs discovered per week
//   - Lead tier distribution (hot / warm / cold)
//   - Top sources by conversion quality
//   - City-level breakdown for GTM planning
// ---------------------------------------------------------------------------

import { FounderEvent } from "./types";

export interface WeeklySummary {
  weekStart: string; // ISO date (Monday)
  weekEnd: string; // ISO date (Sunday)
  totalDiscovered: number;
  totalAttended: number;
  attendanceRate: number; // 0-1
  tierBreakdown: { hot: number; warm: number; cold: number };
  topSources: Array<{ source: string; count: number; avgScore: number }>;
  topCities: Array<{ city: string; count: number }>;
  highLeverageCount: number;
  avgLeadScore: number;
}

export interface SourcePerformance {
  source: string;
  totalEvents: number;
  hotEvents: number;
  warmEvents: number;
  coldEvents: number;
  avgScore: number;
  conversionRate: number; // hot events / total events
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getSunday(monday: Date): Date {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function extractCityFromLocation(location: string): string {
  if (!location) return "Unknown";
  const loc = location.toLowerCase();
  const cities = [
    "London",
    "Berlin",
    "Paris",
    "Amsterdam",
    "San Francisco",
    "New York",
    "Munich",
    "Barcelona",
    "Zurich",
    "Stockholm",
    "Helsinki",
    "Lisbon",
    "Dublin",
    "Copenhagen",
    "Milan",
    "Madrid",
    "Vienna",
    "Warsaw",
    "Brussels",
    "Hamburg",
    "Tel Aviv",
    "Singapore",
    "Dubai",
    "Toronto",
    "Austin",
    "Los Angeles",
    "Boston",
    "Chicago",
    "Seattle",
    "Miami",
  ];
  for (const city of cities) {
    if (loc.includes(city.toLowerCase())) return city;
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Core analytics
// ---------------------------------------------------------------------------

export function computeWeeklySummary(
  events: FounderEvent[],
  weekOf?: Date
): WeeklySummary {
  const targetDate = weekOf ?? new Date();
  const monday = getMonday(targetDate);
  const sunday = getSunday(monday);

  const weekEvents = events.filter((e) => {
    const eventDate = new Date(e.date);
    return eventDate >= monday && eventDate <= sunday;
  });

  const attended = weekEvents.filter((e) => e.attendedAt);
  const scores = weekEvents
    .map((e) => e.leadScore ?? 0)
    .filter((s) => s > 0);

  const tierBreakdown = { hot: 0, warm: 0, cold: 0 };
  for (const e of weekEvents) {
    const tier = e.leadTier ?? "cold";
    tierBreakdown[tier]++;
  }

  // Source aggregation
  const sourceMap = new Map<string, { count: number; totalScore: number }>();
  for (const e of weekEvents) {
    const src = e.source || "unknown";
    const existing = sourceMap.get(src) || { count: 0, totalScore: 0 };
    existing.count++;
    existing.totalScore += e.leadScore ?? 0;
    sourceMap.set(src, existing);
  }
  const topSources = Array.from(sourceMap.entries())
    .map(([source, data]) => ({
      source,
      count: data.count,
      avgScore: data.count > 0 ? Math.round(data.totalScore / data.count) : 0,
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 5);

  // City aggregation
  const cityMap = new Map<string, number>();
  for (const e of weekEvents) {
    const city = extractCityFromLocation(e.location);
    cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
  }
  const topCities = Array.from(cityMap.entries())
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    weekStart: toISODate(monday),
    weekEnd: toISODate(sunday),
    totalDiscovered: weekEvents.length,
    totalAttended: attended.length,
    attendanceRate:
      weekEvents.length > 0 ? attended.length / weekEvents.length : 0,
    tierBreakdown,
    topSources,
    topCities,
    highLeverageCount: weekEvents.filter((e) => e.highLeverage).length,
    avgLeadScore:
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0,
  };
}

export function computeSourcePerformance(
  events: FounderEvent[]
): SourcePerformance[] {
  const sourceMap = new Map<
    string,
    { total: number; hot: number; warm: number; cold: number; scoreSum: number }
  >();

  for (const e of events) {
    const src = e.source || "unknown";
    const existing = sourceMap.get(src) || {
      total: 0,
      hot: 0,
      warm: 0,
      cold: 0,
      scoreSum: 0,
    };
    existing.total++;
    const tier = e.leadTier ?? "cold";
    existing[tier]++;
    existing.scoreSum += e.leadScore ?? 0;
    sourceMap.set(src, existing);
  }

  return Array.from(sourceMap.entries())
    .map(([source, data]) => ({
      source,
      totalEvents: data.total,
      hotEvents: data.hot,
      warmEvents: data.warm,
      coldEvents: data.cold,
      avgScore:
        data.total > 0 ? Math.round(data.scoreSum / data.total) : 0,
      conversionRate:
        data.total > 0
          ? Math.round((data.hot / data.total) * 100) / 100
          : 0,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

// ---------------------------------------------------------------------------
// Trend comparison — week over week
// ---------------------------------------------------------------------------

export function weekOverWeekDelta(
  current: WeeklySummary,
  previous: WeeklySummary
): {
  discoveredDelta: number;
  attendedDelta: number;
  scoreDelta: number;
  hotDelta: number;
} {
  return {
    discoveredDelta: current.totalDiscovered - previous.totalDiscovered,
    attendedDelta: current.totalAttended - previous.totalAttended,
    scoreDelta: current.avgLeadScore - previous.avgLeadScore,
    hotDelta: current.tierBreakdown.hot - previous.tierBreakdown.hot,
  };
}
