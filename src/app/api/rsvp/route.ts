import { NextResponse } from "next/server";
import { FounderEvent } from "@/lib/types";

const RSVP_EMAIL = "william@expedite.now";
const RSVP_NAME = "William Schulz";

interface RSVPResult {
  eventId: string;
  title: string;
  source: string;
  status: "success" | "failed" | "skipped";
  message: string;
}

// RSVP to a Luma event via their API
async function rsvpLuma(event: FounderEvent): Promise<RSVPResult> {
  const slug = event.url.replace("https://lu.ma/", "");

  try {
    // First, get the event API ID from the event page
    const pageRes = await fetch(`https://lu.ma/${slug}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!pageRes.ok) {
      return { eventId: event.id, title: event.title, source: "luma", status: "failed", message: `Page fetch failed: ${pageRes.status}` };
    }

    const html = await pageRes.text();

    // Extract event API ID from page data
    const apiIdMatch = html.match(/"api_id"\s*:\s*"([^"]+)"/) ||
      html.match(/"event_id"\s*:\s*"([^"]+)"/) ||
      html.match(/event\/([a-z0-9-]+)/i);

    const eventApiId = apiIdMatch?.[1] || slug;

    // Try RSVP via Luma's guest registration endpoint
    const rsvpRes = await fetch("https://api.lu.ma/event/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Origin: "https://lu.ma",
        Referer: `https://lu.ma/${slug}`,
      },
      body: JSON.stringify({
        event_api_id: eventApiId,
        name: RSVP_NAME,
        email: RSVP_EMAIL,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (rsvpRes.ok) {
      return { eventId: event.id, title: event.title, source: "luma", status: "success", message: "RSVP'd successfully" };
    }

    // Fallback: try alternative endpoint
    const rsvpRes2 = await fetch(`https://api.lu.ma/event/${eventApiId}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Origin: "https://lu.ma",
      },
      body: JSON.stringify({
        name: RSVP_NAME,
        email: RSVP_EMAIL,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (rsvpRes2.ok) {
      return { eventId: event.id, title: event.title, source: "luma", status: "success", message: "RSVP'd successfully (alt)" };
    }

    // Another fallback
    const rsvpRes3 = await fetch("https://api.lu.ma/public/v1/event/guest/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      body: JSON.stringify({
        event_api_id: eventApiId,
        slug: slug,
        guest: {
          name: RSVP_NAME,
          email: RSVP_EMAIL,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (rsvpRes3.ok) {
      return { eventId: event.id, title: event.title, source: "luma", status: "success", message: "RSVP'd successfully (v1)" };
    }

    const errorText = await rsvpRes.text().catch(() => "unknown error");
    return { eventId: event.id, title: event.title, source: "luma", status: "failed", message: errorText.slice(0, 200) };
  } catch (error) {
    return { eventId: event.id, title: event.title, source: "luma", status: "failed", message: String(error).slice(0, 200) };
  }
}

// RSVP to an Eventbrite event via their checkout flow
async function rsvpEventbrite(event: FounderEvent): Promise<RSVPResult> {
  try {
    // Extract event ID from URL
    const idMatch = event.url.match(/(\d+)(?:\?|$)/);
    if (!idMatch) {
      return { eventId: event.id, title: event.title, source: "eventbrite", status: "skipped", message: "Could not extract event ID from URL" };
    }

    const eventbriteId = idMatch[1];

    // Try the Eventbrite free registration API
    const orderRes = await fetch(`https://www.eventbrite.co.uk/api/v3/events/${eventbriteId}/attendees/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Origin: "https://www.eventbrite.co.uk",
        Referer: event.url,
      },
      body: JSON.stringify({
        attendee: {
          profile: {
            name: RSVP_NAME,
            email: RSVP_EMAIL,
            first_name: "William",
            last_name: "Schulz",
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (orderRes.ok) {
      return { eventId: event.id, title: event.title, source: "eventbrite", status: "success", message: "Registered successfully" };
    }

    return { eventId: event.id, title: event.title, source: "eventbrite", status: "failed", message: `API returned ${orderRes.status}` };
  } catch (error) {
    return { eventId: event.id, title: event.title, source: "eventbrite", status: "failed", message: String(error).slice(0, 200) };
  }
}

// Main RSVP handler — can RSVP to a single event or all events
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { eventId, rsvpAll } = body as { eventId?: string; rsvpAll?: boolean };

    // Fetch all events
    const baseUrl = new URL(request.url).origin;
    const eventsRes = await fetch(`${baseUrl}/api/events`);
    const eventsData = await eventsRes.json();
    const events: FounderEvent[] = eventsData.events || [];

    let toRsvp: FounderEvent[];
    if (rsvpAll) {
      toRsvp = events;
    } else if (eventId) {
      toRsvp = events.filter((e) => e.id === eventId);
    } else {
      return NextResponse.json({ error: "Provide eventId or rsvpAll: true" }, { status: 400 });
    }

    // RSVP to each event based on source
    const results: RSVPResult[] = [];

    // Process in batches of 5 to avoid rate limits
    for (let i = 0; i < toRsvp.length; i += 5) {
      const batch = toRsvp.slice(i, i + 5);
      const batchResults = await Promise.allSettled(
        batch.map((event) => {
          switch (event.source) {
            case "luma":
              return rsvpLuma(event);
            case "eventbrite":
              return rsvpEventbrite(event);
            default:
              return Promise.resolve({
                eventId: event.id,
                title: event.title,
                source: event.source,
                status: "skipped" as const,
                message: `No RSVP handler for ${event.source}`,
              });
          }
        })
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") results.push(r.value);
        else results.push({
          eventId: "unknown",
          title: "unknown",
          source: "unknown",
          status: "failed",
          message: String(r.reason).slice(0, 200),
        });
      }
    }

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return NextResponse.json({
      results,
      summary: { total: results.length, succeeded, failed, skipped },
    });
  } catch (error) {
    console.error("RSVP error:", error);
    return NextResponse.json({ error: "RSVP failed" }, { status: 500 });
  }
}
