import { NextResponse } from "next/server";
import { FounderEvent, isRelevantEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Meetup.com scraper — London startup / tech events
// Uses the public Meetup GraphQL API (no auth required for public events)
// ---------------------------------------------------------------------------

const MEETUP_GRAPHQL = "https://www.meetup.com/gql";

const LONDON_TOPICS = [
  "tech",
  "startup",
  "entrepreneur",
  "founder",
  "venture-capital",
  "angel-investing",
  "saas",
  "artificial-intelligence",
  "fintech",
  "product-management",
  "networking",
  "hackathon",
];

interface MeetupEvent {
  id: string;
  title: string;
  description?: string;
  dateTime?: string;
  endTime?: string;
  venue?: {
    name?: string;
    address?: string;
    city?: string;
    country?: string;
  };
  eventUrl?: string;
  imageUrl?: string;
  group?: { name?: string; urlname?: string };
}

function parseMeetupEvent(raw: MeetupEvent): FounderEvent | null {
  const title = raw.title ?? "";
  if (!title) return null;

  const description = raw.description ?? "";
  if (!isRelevantEvent(title, description)) return null;

  const venue = raw.venue;
  const location = venue?.name
    ? `${venue.name}${venue.address ? ", " + venue.address : ""}${venue.city ? ", " + venue.city : ""}`
    : venue?.city ?? "London";

  const locLower = location.toLowerCase();
  if (
    location &&
    !locLower.includes("london") &&
    !locLower.includes("uk") &&
    !locLower.includes("england") &&
    !locLower.includes("united kingdom")
  ) {
    return null;
  }

  return {
    id: `meetup-${raw.id}`,
    title,
    description: description.replace(/<[^>]*>/g, "").slice(0, 500),
    date: raw.dateTime ?? new Date().toISOString(),
    endDate: raw.endTime ?? undefined,
    location: location || "London",
    url: raw.eventUrl ?? `https://www.meetup.com`,
    source: "meetup",
    category: categorizeEvent(title, description),
    imageUrl: raw.imageUrl ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Strategy 1: Meetup GraphQL API (public, no auth)
// ---------------------------------------------------------------------------
async function fetchViaGraphQL(topic: string): Promise<FounderEvent[]> {
  const now = new Date().toISOString();

  const query = `
    query GetEvents($topic: String!, $lat: Float!, $lon: Float!, $radius: Float!) {
      keywordSearch(
        filter: {
          query: $topic
          lat: $lat
          lon: $lon
          radius: $radius
          source: EVENTS
          startDateRange: "${now}"
        }
        first: 50
      ) {
        edges {
          node {
            result {
              ... on Event {
                id
                title
                description
                dateTime
                endTime
                eventUrl
                imageUrl
                venue {
                  name
                  address
                  city
                  country
                }
                group {
                  name
                  urlname
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(MEETUP_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.meetup.com/",
        Origin: "https://www.meetup.com",
      },
      body: JSON.stringify({
        query,
        variables: {
          topic,
          lat: 51.5074,
          lon: -0.1278,
          radius: 30,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];

    const data = await res.json() as {
      data?: {
        keywordSearch?: {
          edges?: Array<{ node?: { result?: MeetupEvent } }>;
        };
      };
    };

    const edges = data?.data?.keywordSearch?.edges ?? [];

    return edges
      .map((edge) => edge?.node?.result)
      .filter((r): r is MeetupEvent => !!r && !!r.id)
      .map(parseMeetupEvent)
      .filter((e): e is FounderEvent => e !== null);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: Meetup REST API (legacy, no auth for public events)
// ---------------------------------------------------------------------------
async function fetchViaREST(): Promise<FounderEvent[]> {
  const events: FounderEvent[] = [];

  try {
    const url = new URL("https://api.meetup.com/find/events");
    url.searchParams.set("lat", "51.5074");
    url.searchParams.set("lon", "-0.1278");
    url.searchParams.set("radius", "30");
    url.searchParams.set("topic_category_id", "546"); // Tech category
    url.searchParams.set("page", "100");
    url.searchParams.set("order", "time");
    url.searchParams.set("fields", "description,event_url,featured_photo");

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];

    const data = await res.json() as MeetupEvent[];
    if (!Array.isArray(data)) return [];

    for (const raw of data) {
      const evt = parseMeetupEvent(raw);
      if (evt) events.push(evt);
    }
  } catch {
    // REST API may be deprecated/rate-limited — that's fine
  }

  return events;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  // Run GraphQL queries for all topics concurrently
  const results = await Promise.allSettled([
    fetchViaREST(),
    ...LONDON_TOPICS.slice(0, 6).map(fetchViaGraphQL), // First 6 topics
  ]);

  // Run the remaining topics
  const results2 = await Promise.allSettled(
    LONDON_TOPICS.slice(6).map(fetchViaGraphQL)
  );

  const all: FounderEvent[] = [];
  const seen = new Set<string>();

  for (const result of [...results, ...results2]) {
    if (result.status === "fulfilled") {
      for (const evt of result.value) {
        if (!seen.has(evt.id)) {
          seen.add(evt.id);
          all.push(evt);
        }
      }
    }
  }

  // Sort by date
  all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return NextResponse.json({
    source: "meetup",
    count: all.length,
    events: all,
  });
}
