import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// High-profile conference scraper
// Targets specific well-known startup/tech conference sites that aren't on
// Luma/Eventbrite/Partiful — manually curated list, scraped via HTML parsing.
// ---------------------------------------------------------------------------

interface ConferenceDef {
  id: string;
  name: string;
  url: string;
  location: string;
  // If we already know the date (announced), hardcode it — many conf sites
  // are hard to parse programmatically
  knownDate?: string;
  knownEndDate?: string;
  description?: string;
  category?: string;
}

// Manually maintained list of high-signal conferences.
// Add entries here as new conferences are announced.
const CONFERENCES: ConferenceDef[] = [
  // ── Baltics & Nordics ──────────────────────────
  {
    id: "latitude59-2026",
    name: "Latitude59",
    url: "https://latitude59.ee",
    location: "Tallinn, Estonia",
    knownDate: "2026-05-20T09:00:00Z",
    knownEndDate: "2026-05-22T18:00:00Z",
    description: "Premier Baltic startup conference. 3,000+ founders, investors, and tech leaders from 60+ countries.",
    category: "accelerator",
  },
  {
    id: "tallinn-digital-summit-2026",
    name: "Tallinn Digital Summit",
    url: "https://digitalsmefestival.eu",
    location: "Tallinn, Estonia",
    description: "European digital transformation summit bringing together tech leaders, startups, and policymakers.",
    category: "networking",
  },
  {
    id: "slush-2026",
    name: "Slush",
    url: "https://www.slush.org",
    location: "Helsinki, Finland",
    description: "Europe's leading startup event. 13,000+ attendees, 4,000+ startups, 2,000+ investors.",
    category: "accelerator",
  },
  {
    id: "arctic15-2026",
    name: "Arctic15",
    url: "https://arctic15.com",
    location: "Helsinki, Finland",
    description: "Nordic startup and investor matchmaking conference. Strong VC and founder density.",
    category: "fundraising",
  },
  {
    id: "riga-comm-2026",
    name: "Riga Comm",
    url: "https://rigacomm.com",
    location: "Riga, Latvia",
    description: "Baltic tech and business conference with startup pitch stage and innovation expo.",
    category: "networking",
  },
  {
    id: "login-2026",
    name: "LOGIN Conference",
    url: "https://login.lt",
    location: "Vilnius, Lithuania",
    description: "Baltic region's largest tech conference. 4,000+ attendees, startup battlefield.",
    category: "networking",
  },
  {
    id: "oslo-innovation-week-2026",
    name: "Oslo Innovation Week",
    url: "https://oiw.no",
    location: "Oslo, Norway",
    description: "Norway's premier innovation festival. Startups, investors, and corporates.",
    category: "networking",
  },
  // ── Western & Central Europe ───────────────────
  {
    id: "web-summit-2026",
    name: "Web Summit",
    url: "https://websummit.com",
    location: "Lisbon, Portugal",
    description: "World's largest tech conference. 70,000+ attendees. Major international founder pipeline.",
    category: "networking",
  },
  {
    id: "wolves-summit-2026",
    name: "Wolves Summit",
    url: "https://wolvessummit.com",
    location: "Warsaw, Poland",
    description: "Central & Eastern European startup conference. International founders and investors.",
    category: "accelerator",
  },
  {
    id: "tnw-conference-2026",
    name: "TNW Conference",
    url: "https://thenextweb.com/conference",
    location: "Amsterdam, Netherlands",
    description: "Top European tech conference. Strong founder and investor crowd.",
    category: "networking",
  },
  {
    id: "noah-conference-2026",
    name: "NOAH Conference",
    url: "https://www.noah-conference.com",
    location: "Berlin, Germany",
    description: "Premier European internet conference for digital leaders and investors.",
    category: "fundraising",
  },
  {
    id: "tech-open-air-2026",
    name: "Tech Open Air",
    url: "https://toa.berlin",
    location: "Berlin, Germany",
    description: "Berlin's interdisciplinary tech festival for founders and creative thinkers.",
    category: "networking",
  },
  {
    id: "viva-technology-2026",
    name: "Viva Technology",
    url: "https://vivatechnology.com",
    location: "Paris, France",
    description: "Europe's biggest startup and tech event. 150,000+ attendees, major investor presence.",
    category: "networking",
  },
  {
    id: "sifted-summit-2026",
    name: "Sifted Summit",
    url: "https://sifted.eu/events",
    location: "London, UK",
    description: "European startup media summit. Founders, VCs, and operators.",
    category: "networking",
  },
  {
    id: "london-tech-week-2026",
    name: "London Tech Week",
    url: "https://londontechweek.com",
    location: "London, UK",
    description: "London's flagship tech festival. 50,000+ attendees across hundreds of events.",
    category: "networking",
  },
  {
    id: "bits-pretzels-2026",
    name: "Bits & Pretzels",
    url: "https://www.bitsandpretzels.com",
    location: "Munich, Germany",
    description: "Founders festival during Oktoberfest. 5,000+ startup founders and investors.",
    category: "accelerator",
  },
  {
    id: "pirate-summit-2026",
    name: "Pirate Summit",
    url: "https://piratesummit.com",
    location: "Cologne, Germany",
    description: "Early-stage startup conference. Pitch competition and investor matchmaking.",
    category: "pitch",
  },
  {
    id: "pioneers-festival-2026",
    name: "Pioneers Festival",
    url: "https://pioneerfestival.at",
    location: "Vienna, Austria",
    description: "Central European startup festival with pitch competition and investor matchmaking.",
    category: "pitch",
  },
  {
    id: "south-summit-2026",
    name: "South Summit",
    url: "https://www.southsummit.co",
    location: "Madrid, Spain",
    description: "Southern Europe's top startup conference. Pitch competition and investor networking.",
    category: "pitch",
  },
  {
    id: "websummit-rio-2026",
    name: "Web Summit Rio",
    url: "https://rio.websummit.com",
    location: "Rio de Janeiro, Brazil",
    description: "Web Summit's Latin America edition. International founders and investors.",
    category: "networking",
  },
  // ── Community / recurring ──────────────────────
  {
    id: "startup-grind-london-2026",
    name: "Startup Grind London",
    url: "https://www.startupgrind.com/london",
    location: "London, UK",
    description: "Monthly event series for founders. High concentration of early-stage international builders.",
    category: "networking",
  },
  {
    id: "collision-2026",
    name: "Collision Conference",
    url: "https://collisionconf.com",
    location: "Toronto, Canada",
    description: "North America's fastest-growing tech conference. Strong international founder attendance.",
    category: "networking",
  },
  {
    id: "techcrunch-disrupt-2026",
    name: "TechCrunch Disrupt",
    url: "https://techcrunch.com/events/disrupt",
    location: "San Francisco, USA",
    description: "Premier startup launch conference. Startup battlefield, 10,000+ attendees.",
    category: "pitch",
  },
  {
    id: "rise-conf-2026",
    name: "RISE Conference",
    url: "https://riseconf.com",
    location: "Hong Kong",
    description: "Asia's largest tech conference by Web Summit. 15,000+ attendees.",
    category: "networking",
  },
];

// ---------------------------------------------------------------------------
// Try to fetch live date from each conference site
// Falls back to returning the conference without a date if parsing fails
// ---------------------------------------------------------------------------
async function fetchConferenceDate(conf: ConferenceDef): Promise<{ startDate: string; endDate?: string } | null> {
  if (conf.knownDate) return { startDate: conf.knownDate, endDate: conf.knownEndDate };

  try {
    const res = await fetch(conf.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Try JSON-LD first
    const jsonLdMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of jsonLdMatches) {
      try {
        const ld = JSON.parse(match[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if ((item["@type"] === "Event" || item["@type"] === "BusinessEvent") && item.startDate) {
            return { startDate: item.startDate, endDate: item.endDate };
          }
        }
      } catch { /* skip */ }
    }

    // Try common date patterns in HTML (e.g. "May 21-23, 2026" or "21 May 2026")
    const yearMatch = html.match(/202[5-9]/);
    if (!yearMatch) return null;

    const year = yearMatch[0];
    const months: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04",
      may: "05", june: "06", july: "07", august: "08",
      september: "09", october: "10", november: "11", december: "12",
    };

    for (const [month, num] of Object.entries(months)) {
      const re = new RegExp(`(\\d{1,2})(?:\\s*[-–]\\s*(\\d{1,2}))?\\s+${month}\\s*,?\\s*${year}`, "i");
      const m = html.match(re);
      if (m) {
        const day = m[1].padStart(2, "0");
        return { startDate: `${year}-${num}-${day}T09:00:00Z`, endDate: m[2] ? `${year}-${num}-${m[2].padStart(2, "0")}T18:00:00Z` : undefined };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() + 12); // look up to 12 months ahead for conferences

  const results = await Promise.allSettled(
    CONFERENCES.map(async (conf) => {
      const dates = await fetchConferenceDate(conf);

      // If we have a date, validate it's in range
      if (dates?.startDate) {
        const d = new Date(dates.startDate);
        if (d < now || d > cutoff) return null;
      }

      const event: FounderEvent = {
        id: conf.id,
        title: conf.name,
        description: conf.description ?? "",
        date: dates?.startDate ?? "",
        endDate: dates?.endDate,
        location: conf.location,
        url: conf.url,
        source: "conference", // closest category — shown as "Conference" via category
        category: conf.category ?? categorizeEvent(conf.name, conf.description ?? ""),
        imageUrl: undefined,
      };

      return event;
    })
  );

  const events: FounderEvent[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      events.push(r.value);
    }
  }

  events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return NextResponse.json({ events, count: events.length, source: "conferences" });
}
