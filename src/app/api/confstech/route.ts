import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// confs.tech scraper
// Fetches conference data from the confs.tech public GitHub JSON API
// https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/YYYY/<topic>.json
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

const TOPICS = [
  "javascript",
  "python",
  "devops",
  "general",
  "ai-ml",
  "cloud",
  "data",
  "security",
];

const YEAR = "2026";

const BASE_URL =
  "https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences";

// ---------------------------------------------------------------------------
// Cities & countries we care about
// ---------------------------------------------------------------------------
const TARGET_CITIES = new Set([
  "london", "berlin", "paris", "amsterdam", "munich", "zurich", "vienna",
  "stockholm", "helsinki", "copenhagen", "tallinn", "riga", "vilnius", "oslo",
  "dublin", "lisbon", "barcelona", "madrid", "warsaw", "brussels", "budapest",
  "prague", "milan", "rome", "hamburg", "geneva", "lausanne",
  "san francisco", "new york", "austin", "boston", "toronto",
]);

const TARGET_COUNTRIES = new Set([
  "u.s.a.", "usa", "united states",
  "u.k.", "uk", "united kingdom", "england",
  "germany", "france", "netherlands", "sweden", "finland", "denmark",
  "norway", "estonia", "latvia", "lithuania", "ireland", "portugal",
  "spain", "austria", "switzerland", "poland", "belgium", "italy",
  "czech republic", "czechia", "hungary", "canada",
]);

// ---------------------------------------------------------------------------
// Raw entry shape from confs.tech JSON
// ---------------------------------------------------------------------------
interface ConfsTechEntry {
  name: string;
  url: string;
  startDate: string; // "YYYY-MM-DD"
  endDate?: string;
  city?: string;
  country?: string;
  online?: boolean;
}

function isRelevantLocation(entry: ConfsTechEntry): boolean {
  // Online events are always relevant
  if (entry.online) return true;

  const city = (entry.city ?? "").toLowerCase().trim();
  const country = (entry.country ?? "").toLowerCase().trim();

  if (TARGET_CITIES.has(city)) return true;
  if (TARGET_COUNTRIES.has(country)) return true;

  return false;
}

function toFounderEvent(entry: ConfsTechEntry, topic: string): FounderEvent {
  const locationParts: string[] = [];
  if (entry.city) locationParts.push(entry.city);
  if (entry.country) locationParts.push(entry.country);
  if (entry.online) locationParts.push("Online");
  const location = locationParts.join(", ") || "TBD";

  const description = `${topic} conference — ${entry.name}`;
  const category = categorizeEvent(entry.name, description);

  return {
    id: `conf-${hashString(entry.name + entry.startDate)}`,
    title: entry.name,
    description,
    date: entry.startDate ? `${entry.startDate}T09:00:00Z` : "",
    endDate: entry.endDate ? `${entry.endDate}T18:00:00Z` : undefined,
    location,
    url: entry.url,
    source: "luma",
    category,
  };
}

// ---------------------------------------------------------------------------
// Fetch a single topic's conference list
// ---------------------------------------------------------------------------
async function fetchTopic(topic: string): Promise<ConfsTechEntry[]> {
  const url = `${BASE_URL}/${YEAR}/${topic}.json`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data: ConfsTechEntry[] = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    // Network error, timeout, or invalid JSON — skip this topic
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const now = new Date();

  // Fetch all topics in parallel
  const results = await Promise.allSettled(
    TOPICS.map((topic) =>
      fetchTopic(topic).then((entries) =>
        entries
          .filter(isRelevantLocation)
          .map((entry) => toFounderEvent(entry, topic))
      )
    )
  );

  // Flatten and deduplicate by id
  const seen = new Set<string>();
  const events: FounderEvent[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const event of r.value) {
      // Skip past events
      if (event.date) {
        const d = new Date(event.date);
        if (d < now) continue;
      }
      if (!seen.has(event.id)) {
        seen.add(event.id);
        events.push(event);
      }
    }
  }

  // Sort by date ascending
  events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return NextResponse.json({ events, count: events.length, source: "confstech" });
}
