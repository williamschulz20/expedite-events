import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/calendar  →  returns .ics feed of all accepted events
// Subscribe in Apple Calendar via: webcal://your-domain/api/calendar
export async function GET() {
  const { data: events } = await supabase
    .schema("event_scraper")
    .from("scraped_events")
    .select("*")
    .not("accepted_at", "is", null)
    .order("starts_at", { ascending: true });

  const rows = events ?? [];

  const vevents = rows.map((evt) => {
    const start = evt.starts_at ? formatICSDate(new Date(evt.starts_at)) : formatICSDate(new Date());
    const end   = evt.ends_at   ? formatICSDate(new Date(evt.ends_at))   : start;
    const desc  = [
      evt.description ?? "",
      evt.url ? `RSVP: ${evt.url}` : "",
      evt.lead_tier ? `Lead tier: ${evt.lead_tier}` : "",
    ].filter(Boolean).join("\n").replace(/\n/g, "\\n").replace(/,/g, "\\,");

    const attended = evt.attended_at ? "\nX-ATTENDED:TRUE" : "";

    return [
      "BEGIN:VEVENT",
      `UID:${evt.external_id}@expedite-events`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${evt.title.replace(/,/g, "\\,")}`,
      `DESCRIPTION:${desc}${attended}`,
      evt.location ? `LOCATION:${evt.location.replace(/,/g, "\\,")}` : "",
      evt.url      ? `URL:${evt.url}` : "",
      `CATEGORIES:${tierToCategory(evt.lead_tier)}`,
      "END:VEVENT",
    ].filter(Boolean).join("\r\n");
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Expedite Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Expedite Events",
    "X-WR-CALDESC:Founder events accepted via Expedite lead pipeline",
    "X-WR-TIMEZONE:Europe/London",
    ...vevents,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type":  "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
    },
  });
}

function formatICSDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function tierToCategory(tier: string | null): string {
  if (tier === "hot")  return "Hot Lead";
  if (tier === "warm") return "Warm Lead";
  return "Event";
}
