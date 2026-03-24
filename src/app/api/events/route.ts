import { NextResponse } from "next/server";
import { FounderEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin;

  try {
    // Fetch from all three sources in parallel
    const [eventbriteRes, lumaRes, partifulRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/eventbrite`).then((r) => r.json()),
      fetch(`${baseUrl}/api/luma`).then((r) => r.json()),
      fetch(`${baseUrl}/api/partiful`).then((r) => r.json()),
    ]);

    const allEvents: FounderEvent[] = [];
    const warnings: string[] = [];

    if (eventbriteRes.status === "fulfilled" && eventbriteRes.value.events) {
      allEvents.push(...eventbriteRes.value.events);
    } else {
      warnings.push("Eventbrite: failed to fetch");
    }

    if (lumaRes.status === "fulfilled" && lumaRes.value.events) {
      allEvents.push(...lumaRes.value.events);
    } else {
      warnings.push("Luma: failed to fetch");
    }

    if (partifulRes.status === "fulfilled" && partifulRes.value.events) {
      allEvents.push(...partifulRes.value.events);
    } else {
      warnings.push("Partiful: failed to fetch");
    }

    // Deduplicate by title + date similarity
    const seen = new Set<string>();
    const uniqueEvents = allEvents.filter((event) => {
      const key = `${event.title.toLowerCase().trim()}-${event.date.substring(0, 10)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by date ascending
    uniqueEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Filter to events in the next 3 months
    const now = new Date();
    const threeMonthsOut = new Date(now);
    threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);
    const futureEvents = uniqueEvents.filter((e) => {
      const d = new Date(e.date);
      return d >= now && d <= threeMonthsOut;
    });

    return NextResponse.json({
      events: futureEvents,
      total: futureEvents.length,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    console.error("Events aggregation error:", error);
    return NextResponse.json({ error: "Failed to fetch events", events: [] }, { status: 500 });
  }
}
