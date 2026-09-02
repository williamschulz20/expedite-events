import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import { politeText, throttledBatch } from "@/lib/politeFetch";

// ---------------------------------------------------------------------------
// GarysGuide regions.
//
// The site only publishes two regions, and the query param uses short slugs.
// The previous list ("sfbay", "newyork", "losangeles", "boston", "austin",
// "london") is not recognised by the site — those URLs render an empty shell,
// which was one reason this endpoint returned nothing.
// ---------------------------------------------------------------------------
const REGIONS = [
  { slug: "nyc", label: "New York City" },
  { slug: "sf", label: "San Francisco Bay Area" },
];

const HORIZON_DAYS = 365;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Strip tags, decode entities, collapse whitespace. */
function toText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ---------------------------------------------------------------------------
// GarysGuide markup (verified against the live site).
//
// Each listing row is a table cell holding the day, followed by the title,
// venue and speaker blurb:
//
//   <td align='center' valign='top' width='48'><b>Sep 01</b><br/>9:00am</td>
//   ...
//   <font class='ftitle'><a href='https://www.garysguide.com/events/<id>/<Slug>'>
//     <b>AI Enterprise Conference</b></a></font>
//   <font class='fdescription'><br/><b>Pier Sixty</b>, 60 Chelsea Piers</font>
//   <font class='fgray'>With Michael Beal <i>(...)</i>, ...</font>
//
// Notes that broke the old parser:
//   * there is no JSON-LD anywhere on the site (listing or detail pages);
//   * hrefs are absolute and single-quoted, and the path has two segments
//     (/events/<id>/<Slug>), so the old /events/<slug> relative pattern that
//     required double quotes never matched;
//   * the listing carries no year — it is inferred from the current date;
//   * a trailing "+" on the day (e.g. "Sep 10+") marks a multi-day event.
// ---------------------------------------------------------------------------
const DATE_CELL_RE =
  /width=['"]48['"]\s*>\s*<b>\s*([A-Za-z]{3})\s+(\d{1,2})\s*(\+?)\s*<\/b>\s*(?:<br\s*\/?>\s*([^<]*))?/gi;

const TITLE_RE =
  /<font\s+class=['"]ftitle['"]\s*>\s*<a[^>]*href=['"]([^'"]+)['"][^>]*>\s*(?:<b>)?([\s\S]*?)(?:<\/b>)?\s*<\/a>/i;

const VENUE_RE = /<font\s+class=['"]fdescription['"]\s*>([\s\S]*?)<\/font>/i;
const BLURB_RE = /<font\s+class=['"]fgray['"]\s*>([\s\S]*?)<\/font>/i;

/** "9:00am" -> [9, 0]; defaults to 09:00 when absent or unparseable. */
function parseClock(raw: string): [number, number] {
  const m = raw.match(/(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
  if (!m) return [9, 0];
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") hour += 12;
  return [hour, Number(m[2])];
}

/**
 * The listing omits the year. Resolve it against today: a month/day that would
 * land more than a month in the past belongs to next year (the site rolls into
 * January while still showing the tail of December).
 */
function resolveIsoDate(
  monthAbbr: string,
  day: number,
  clock: string,
  now: Date
): string {
  const month = MONTHS[monthAbbr.toLowerCase()];
  if (month === undefined || day < 1 || day > 31) return "";

  const [hour, minute] = parseClock(clock);
  let year = now.getFullYear();
  let dt = new Date(year, month, day, hour, minute);
  if ((dt.getTime() - now.getTime()) / 86_400_000 < -31) {
    year += 1;
    dt = new Date(year, month, day, hour, minute);
  }
  if (dt.getMonth() !== month || dt.getDate() !== day) return ""; // e.g. Feb 30

  // Local wall-clock ISO — these are venue-local times, so no Z suffix.
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
}

// ---------------------------------------------------------------------------
// Parse one region listing page
// ---------------------------------------------------------------------------
function parseListing(
  html: string,
  regionLabel: string,
  now: Date
): FounderEvent[] {
  const events: FounderEvent[] = [];
  if (!html) return events;

  // Collect the day-cell anchors first so each event's markup can be sliced
  // out as the span between one day cell and the next.
  const cells: Array<{ end: number; month: string; day: number; multi: boolean; clock: string }> = [];
  const starts: number[] = [];
  DATE_CELL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DATE_CELL_RE.exec(html)) !== null) {
    starts.push(m.index);
    cells.push({
      end: m.index + m[0].length,
      month: m[1],
      day: Number(m[2]),
      multi: m[3] === "+",
      clock: (m[4] || "").trim(),
    });
  }

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const chunk = html.slice(cell.end, starts[i + 1] ?? html.length);

    const titleMatch = chunk.match(TITLE_RE);
    if (!titleMatch) continue;

    const url = decodeEntities(titleMatch[1]).trim();
    const title = toText(titleMatch[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;

    const venueMatch = chunk.match(VENUE_RE);
    // "<b>Pier Sixty</b>, 60 Chelsea Piers" -> "Pier Sixty, 60 Chelsea Piers"
    const venue = venueMatch ? toText(venueMatch[1]).replace(/\s+,/g, ",") : "";

    const blurbMatch = chunk.match(BLURB_RE);
    const blurb = blurbMatch ? toText(blurbMatch[1]) : "";

    const date = resolveIsoDate(cell.month, cell.day, cell.clock, now);

    // Venue is a strong signal for the scorer and for the reader, so fold it
    // into the description alongside the speaker blurb.
    const description = [blurb, venue && `Venue: ${venue}`, cell.multi ? "Multi-day event." : ""]
      .filter(Boolean)
      .join(" ")
      .slice(0, 800);

    const location =
      venue && !/^venue,?\s*(to be announced)?$/i.test(venue)
        ? `${venue}, ${regionLabel}`
        : regionLabel;

    events.push({
      id: `gg-${hashString(url)}`,
      title: title.slice(0, 200),
      description,
      date,
      location: location.slice(0, 300),
      url,
      source: "garysguide",
      category: categorizeEvent(title, description),
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const now = new Date();
    const horizon = now.getTime() + HORIZON_DAYS * 86_400_000;
    const floor = now.getTime() - 2 * 86_400_000; // tolerate today / just-passed

    // Two pages only, fetched gently and sequentially-ish.
    const pages = await throttledBatch(
      REGIONS.map((r) => async () => ({
        label: r.label,
        html: await politeText(
          `https://www.garysguide.com/events?region=${r.slug}`,
          { timeoutMs: 25_000 }
        ),
      })),
      { concurrency: 1, pauseMs: 1200 }
    );

    const parsed: FounderEvent[] = [];
    for (const page of pages) {
      parsed.push(...parseListing(page.html, page.label, now));
    }

    // Dedup by canonical URL.
    const seen = new Set<string>();
    const unique = parsed.filter((e) => {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });

    // Score, and keep what the pipeline would actually store (score > 0).
    const scored: FounderEvent[] = [];
    for (const e of unique) {
      if (e.date) {
        const t = new Date(e.date).getTime();
        if (Number.isFinite(t) && (t < floor || t > horizon)) continue;
      }
      const sc = scoreLeadQuality(e.title, e.description);
      if (sc.score <= 0) continue;
      scored.push({
        ...e,
        leadScore: sc.score,
        leadTier: sc.tier,
        highLeverage: sc.highLeverage,
        leverageReason: sc.leverageReason,
      });
    }

    scored.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return NextResponse.json({
      events: scored,
      count: scored.length,
      parsed: unique.length,
      source: "garysguide",
    });
  } catch (error) {
    console.error("GarysGuide route error:", error);
    return NextResponse.json(
      { events: [], count: 0, parsed: 0, source: "garysguide" },
      { status: 500 }
    );
  }
}
