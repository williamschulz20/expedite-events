import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// developers.events scraper
// Fetches the full event dump from https://developers.events/all-events.json
// and filters to 2026 events in target countries/cities.
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ---------------------------------------------------------------------------
// Target locations
// ---------------------------------------------------------------------------
const TARGET_CITIES = new Set([
  "london", "berlin", "paris", "amsterdam", "munich", "zurich", "vienna",
  "stockholm", "helsinki", "copenhagen", "tallinn", "riga", "vilnius", "oslo",
  "dublin", "lisbon", "barcelona", "madrid", "warsaw", "brussels", "budapest",
  "prague", "milan", "rome", "hamburg", "geneva", "lausanne",
  "san francisco", "los angeles", "new york", "austin", "boston", "toronto",
]);

const TARGET_COUNTRIES = new Set([
  "u.s.a.", "usa", "united states", "us",
  "u.k.", "uk", "united kingdom", "england",
  "germany", "france", "netherlands", "sweden", "finland", "denmark",
  "norway", "estonia", "latvia", "lithuania", "ireland", "portugal",
  "spain", "austria", "switzerland", "poland", "belgium", "italy",
  "czech republic", "czechia", "hungary", "canada",
  "romania", "bulgaria", "croatia", "serbia", "greece",
]);

// ---------------------------------------------------------------------------
// Raw entry shape from developers.events JSON
// ---------------------------------------------------------------------------
interface DevEventsEntry {
  name: string;
  hyperlink: string;
  startDate: string;  // "YYYY-MM-DD" or ISO
  endDate?: string;
  city?: string;
  country?: string;
  online?: boolean;
  category?: string;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function isIn2026(entry: DevEventsEntry): boolean {
  if (!entry.startDate) return false;
  return entry.startDate.startsWith("2026");
}

function isRelevantLocation(entry: DevEventsEntry): boolean {
  if (entry.online) return true;

  const city = (entry.city ?? "").toLowerCase().trim();
  const country = (entry.country ?? "").toLowerCase().trim();

  if (TARGET_CITIES.has(city)) return true;
  if (TARGET_COUNTRIES.has(country)) return true;

  // Fuzzy: check if any target country appears as a substring
  for (const tc of TARGET_COUNTRIES) {
    if (country.includes(tc)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Map to FounderEvent
// ---------------------------------------------------------------------------
function toFounderEvent(entry: DevEventsEntry): FounderEvent {
  const locationParts: string[] = [];
  if (entry.city) locationParts.push(entry.city);
  if (entry.country) locationParts.push(entry.country);
  if (entry.online) locationParts.push("Online");
  const location = locationParts.join(", ") || "TBD";

  const description = entry.category
    ? `${entry.category} — ${entry.name}`
    : entry.name;

  const category = categorizeEvent(entry.name, description);

  return {
    id: `devev-${hashString(entry.hyperlink || entry.name + entry.startDate)}`,
    title: entry.name,
    description,
    date: entry.startDate
      ? entry.startDate.includes("T")
        ? entry.startDate
        : `${entry.startDate}T09:00:00Z`
      : "",
    endDate: entry.endDate
      ? entry.endDate.includes("T")
        ? entry.endDate
        : `${entry.endDate}T18:00:00Z`
      : undefined,
    location,
    url: entry.hyperlink,
    source: "luma",
    category,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const res = await fetch("https://developers.events/all-events.json", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `developers.events returned ${res.status}` },
        { status: 502 },
      );
    }

    const data: DevEventsEntry[] = await res.json();
    if (!Array.isArray(data)) {
      return NextResponse.json(
        { error: "Unexpected response format from developers.events" },
        { status: 502 },
      );
    }

    const now = new Date();

    // Deduplicate by URL
    const seenUrls = new Set<string>();
    const events: FounderEvent[] = [];

    for (const entry of data) {
      // Must be 2026 and in a relevant location
      if (!isIn2026(entry)) continue;
      if (!isRelevantLocation(entry)) continue;

      // Skip past events
      const startStr = entry.startDate.includes("T")
        ? entry.startDate
        : `${entry.startDate}T09:00:00Z`;
      if (new Date(startStr) < now) continue;

      // Dedup by hyperlink
      const url = (entry.hyperlink ?? "").trim();
      if (url && seenUrls.has(url)) continue;
      if (url) seenUrls.add(url);

      events.push(toFounderEvent(entry));
    }

    // Sort by date ascending
    events.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return NextResponse.json({ events, count: events.length, source: "devevents" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch developers.events: ${message}` },
      { status: 502 },
    );
  }
}
