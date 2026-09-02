import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/accept  { dbId: string }
// Marks the event as accepted in Supabase and returns a .ics file
// that opens directly in Apple Calendar when downloaded.
export async function POST(request: Request) {
  try {
    const { dbId } = await request.json() as { dbId: string };
    if (!dbId) return NextResponse.json({ error: "dbId required" }, { status: 400 });

    // Fetch the event
    const { data: event, error } = await supabase
      .from("scraped_events")
      .select("*")
      .eq("id", dbId)
      .single();

    if (error || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Mark as accepted
    await supabase
      .from("scraped_events")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", dbId);

    // Build .ics content
    const ics = buildICS({
      uid:         `${event.external_id}@expedite-events`,
      title:       event.title,
      description: event.description ?? "",
      location:    event.location ?? "",
      url:         event.url,
      startsAt:    event.starts_at,
      endsAt:      event.ends_at,
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type":        "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slugify(event.title)}.ics"`,
      },
    });
  } catch (err) {
    console.error("Accept error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

function buildICS(evt: {
  uid: string;
  title: string;
  description: string;
  location: string;
  url: string;
  startsAt: string | null;
  endsAt: string | null;
}) {
  const now    = formatICSDate(new Date());
  const start  = evt.startsAt ? formatICSDate(new Date(evt.startsAt)) : now;
  const end    = evt.endsAt   ? formatICSDate(new Date(evt.endsAt))   : start;
  const desc   = (evt.description + (evt.url ? `\n\nRSVP: ${evt.url}` : ""))
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Expedite Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${evt.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${evt.title.replace(/,/g, "\\,")}`,
    `DESCRIPTION:${desc}`,
    evt.location ? `LOCATION:${evt.location.replace(/,/g, "\\,")}` : "",
    evt.url      ? `URL:${evt.url}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function formatICSDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
}
