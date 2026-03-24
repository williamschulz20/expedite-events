import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// This endpoint is called by the Vercel cron job daily at 8am UTC
// It fetches events and auto-RSVPs to all of them
export async function GET(request: Request) {
  // Verify this is a cron request (Vercel sets this header)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Allow cron requests from Vercel (they don't need auth) or with the secret
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Still allow if no auth header (Vercel cron calls)
    const isVercelCron = request.headers.get("x-vercel-cron");
    if (!isVercelCron) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const baseUrl = new URL(request.url).origin;

  try {
    // Step 1: Trigger event refresh by hitting the events endpoint
    const eventsRes = await fetch(`${baseUrl}/api/events`);
    const eventsData = await eventsRes.json();
    const eventCount = eventsData.events?.length || 0;

    // Step 2: Auto-RSVP to all events
    const rsvpRes = await fetch(`${baseUrl}/api/rsvp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rsvpAll: true }),
    });
    const rsvpData = await rsvpRes.json();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      eventsFound: eventCount,
      rsvp: rsvpData.summary,
    });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
