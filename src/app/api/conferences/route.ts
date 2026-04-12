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
    knownDate: "2026-11-19T09:00:00Z",
    knownEndDate: "2026-11-20T18:00:00Z",
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
    id: "saastanak-2026",
    name: "SaaSTanak",
    url: "https://saastanak.com",
    location: "Sibenik, Croatia",
    knownDate: "2026-05-25T09:00:00Z",
    knownEndDate: "2026-05-27T18:00:00Z",
    description: "Largest SaaS community conference in CEE. SaaS founders, operators, and investors from Central & Eastern Europe.",
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
    knownDate: "2026-06-17T09:00:00Z",
    knownEndDate: "2026-06-20T18:00:00Z",
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
  // ── New world conferences ─────────────────────
  {
    id: "eu-startups-summit-2026",
    name: "EU-Startups Summit",
    url: "https://www.eu-startups.com/summit/",
    location: "Valletta, Malta",
    knownDate: "2026-05-07T09:00:00Z",
    knownEndDate: "2026-05-08T18:00:00Z",
    description: "2,500+ founders, investors, VCs from across Europe. Pitch competition with 15 top early-stage startups.",
    category: "pitch",
  },
  {
    id: "startup-grind-global-2026",
    name: "Startup Grind Conference",
    url: "https://www.startupgrind.tech/",
    location: "Redwood City, USA",
    knownDate: "2026-04-28T09:00:00Z",
    knownEndDate: "2026-04-29T18:00:00Z",
    description: "Silicon Valley. 400+ VC funds, proven mentors. Tactical education on fundraising, product, scaling.",
    category: "accelerator",
  },
  {
    id: "hello-tomorrow-2026",
    name: "Hello Tomorrow Global Summit",
    url: "https://hello-tomorrow.org/global-summit/",
    location: "Amsterdam, Netherlands",
    knownDate: "2026-06-11T09:00:00Z",
    knownEndDate: "2026-06-12T18:00:00Z",
    description: "Deep tech world summit. 3,000+ attendees, 4 stages, 100+ speakers. Investor Day and LP/GP event.",
    category: "accelerator",
  },
  {
    id: "gitex-europe-2026",
    name: "GITEX Europe",
    url: "https://www.gitexeurope.com/",
    location: "Berlin, Germany",
    knownDate: "2026-06-30T09:00:00Z",
    knownEndDate: "2026-07-01T18:00:00Z",
    description: "European edition of the world's largest tech exhibition. AI, cybersecurity, deep tech. North Star startup summit.",
    category: "networking",
  },
  {
    id: "upstream-rotterdam-2026",
    name: "Upstream Festival",
    url: "https://www.upstreamfestival.com/",
    location: "Rotterdam, Netherlands",
    knownDate: "2026-05-21T09:00:00Z",
    knownEndDate: "2026-05-21T18:00:00Z",
    description: "Startup festival for early-stage founders, investors, and corporate leaders.",
    category: "networking",
  },
  {
    id: "deel-pitch-global-finals-2026",
    name: "The Pitch by Deel — Global Finals",
    url: "https://www.deel.com/the-pitch-by-deel/",
    location: "Multiple Cities",
    knownDate: "2026-05-18T09:00:00Z",
    knownEndDate: "2026-05-19T18:00:00Z",
    description: "$15M global startup tournament. 20,000+ startups. $1M SAFE for each of 10 global champions.",
    category: "pitch",
  },
  {
    id: "techcrunch-disrupt-2026",
    name: "TechCrunch Disrupt",
    url: "https://techcrunch.com/events/tc-disrupt-2026/",
    location: "San Francisco, USA",
    knownDate: "2026-10-13T09:00:00Z",
    knownEndDate: "2026-10-15T18:00:00Z",
    description: "Premier startup launch conference. Startup battlefield, 10,000+ attendees.",
    category: "pitch",
  },
  {
    id: "techcrunch-founder-summit-2026",
    name: "TechCrunch Founder Summit",
    url: "https://techcrunch.com/events/techcrunch-founder-summit-2026/",
    location: "Boston, USA",
    knownDate: "2026-06-23T09:00:00Z",
    knownEndDate: "2026-06-23T18:00:00Z",
    description: "1,100 founders and investors. Growth, execution, real-world scaling tactics.",
    category: "accelerator",
  },
  {
    id: "collision-2026",
    name: "Collision Conference",
    url: "https://collisionconf.com",
    location: "Toronto, Canada",
    knownDate: "2026-06-03T09:00:00Z",
    knownEndDate: "2026-06-04T18:00:00Z",
    description: "North America's fastest-growing tech conference. Strong international founder attendance.",
    category: "networking",
  },
  {
    id: "startupcon-europe-2026",
    name: "StartupCon Europe",
    url: "https://startupcon.eu/",
    location: "Cyprus",
    description: "Flagship pitch competition. 8 startups pitching to 70+ investors and 400+ attendees.",
    category: "pitch",
  },
  {
    id: "startup-day-tartu-2026",
    name: "sTARTUp Day",
    url: "https://www.startupday.ee/",
    location: "Tartu, Estonia",
    knownDate: "2026-01-28T09:00:00Z",
    knownEndDate: "2026-01-30T18:00:00Z",
    description: "3,000+ entrepreneurs and investors. 350+ startups, 200+ investors, 70+ exhibitors. Early-stage focus.",
    category: "accelerator",
  },
  {
    id: "sxsw-london-2026",
    name: "SXSW London",
    url: "https://www.sxswlondon.com",
    location: "London, UK",
    knownDate: "2026-06-01T09:00:00Z",
    knownEndDate: "2026-06-06T22:00:00Z",
    description: "Music, film, tech and culture. AI, startups, innovation conference in Shoreditch.",
    category: "networking",
  },
  {
    id: "founders-forum-2026",
    name: "Founders Forum",
    url: "https://ff.co/events-for-founders/founders-forum/",
    location: "London, UK",
    description: "Invite-only gathering of world's top founders and CEOs. Annual gala dinner in central London.",
    category: "networking",
  },
  {
    id: "global-founders-conference-2026",
    name: "Global Founders Conference",
    url: "https://topfoundersleadership.com/",
    location: "Las Vegas, USA",
    knownDate: "2026-04-07T09:00:00Z",
    knownEndDate: "2026-04-09T18:00:00Z",
    description: "Global Founders Conference. Also held in Singapore (Dec 2-4) and Dubai (Dec 8-10).",
    category: "networking",
  },
  {
    id: "start-summit-2026",
    name: "START Summit",
    url: "https://www.startglobal.org/start-summit",
    location: "St. Gallen, Switzerland",
    knownDate: "2026-03-19T09:00:00Z",
    knownEndDate: "2026-03-20T18:00:00Z",
    description: "Europe's largest student-organized startup conference. 6,000+ participants. Founders, VCs, corporates.",
    category: "accelerator",
  },
  {
    id: "bits-pretzels-2026",
    name: "Bits & Pretzels",
    url: "https://www.bitsandpretzels.com",
    location: "Munich, Germany",
    knownDate: "2026-09-28T09:00:00Z",
    knownEndDate: "2026-09-30T18:00:00Z",
    description: "Founders festival during Oktoberfest. 7,500 startup founders, investors, and industry leaders.",
    category: "accelerator",
  },
  // ── Founder-specific conferences ──────────────
  {
    id: "founderland-summit-2026",
    name: "Founderland Summit",
    url: "https://www.founderland.org",
    location: "Berlin, Germany",
    description: "Europe's community for underrepresented founders. Pitch competition, networking, and founder workshops.",
    category: "pitch",
  },
  {
    id: "turing-fest-2026",
    name: "Turing Fest",
    url: "https://www.turingfest.com",
    location: "Edinburgh, UK",
    description: "Startup and tech leadership festival. Founders, CTOs, and product leaders share scaling stories.",
    category: "accelerator",
  },
  {
    id: "unicorn-bakery-summit-2026",
    name: "Unicorn Bakery Live Summit",
    url: "https://www.unicornbakery.de",
    location: "Berlin, Germany",
    description: "Top German-language founder podcast live event. International founders, VCs, and operators.",
    category: "networking",
  },
  {
    id: "seedstars-summit-2026",
    name: "Seedstars Summit",
    url: "https://www.seedstars.com",
    location: "Lausanne, Switzerland",
    description: "Global emerging market founders. Pitch competition, mentoring, and investor matchmaking.",
    category: "pitch",
  },
  {
    id: "founders-pledge-summit-2026",
    name: "Founders Pledge Summit",
    url: "https://founderspledge.com",
    location: "London, UK",
    description: "Community of tech founders committed to philanthropy. High-net-worth founder networking.",
    category: "networking",
  },
  {
    id: "tech-nation-founders-network-2026",
    name: "Tech Nation Founders Network",
    url: "https://technation.io",
    location: "London, UK",
    description: "UK's leading founder scaling programme. Access to Global Talent Visa support and US expansion.",
    category: "accelerator",
  },
  {
    id: "f-founders-2026",
    name: "F.Founders",
    url: "https://ffounders.com",
    location: "Various",
    description: "Invite-only dinner for 150 leading startup founders at major tech conferences worldwide.",
    category: "networking",
  },
  {
    id: "dmexco-2026",
    name: "DMEXCO",
    url: "https://dmexco.com",
    location: "Cologne, Germany",
    knownDate: "2026-09-16T09:00:00Z",
    knownEndDate: "2026-09-17T18:00:00Z",
    description: "Digital marketing expo and conference. 40,000+ attendees, MarTech founders and growth leaders.",
    category: "networking",
  },
  {
    id: "4yfn-2026",
    name: "4YFN (Four Years From Now)",
    url: "https://www.4yfn.com",
    location: "Barcelona, Spain",
    description: "Startup event at MWC. 30,000+ attendees, 1,000+ startups, investor meetings and pitch stages.",
    category: "pitch",
  },
  {
    id: "unbound-london-2026",
    name: "Unbound London",
    url: "https://www.unboundglobal.com",
    location: "London, UK",
    description: "Innovation festival connecting startups with corporates. 5,000+ founders, investors, and innovators.",
    category: "networking",
  },
  {
    id: "wired-summit-2026",
    name: "WIRED Summit",
    url: "https://www.wired.co.uk",
    location: "London, UK",
    description: "WIRED magazine flagship event. Tech founders, researchers, and industry leaders.",
    category: "networking",
  },
  {
    id: "cto-summit-london-2026",
    name: "CTO Summit London",
    url: "https://ctosummit.io",
    location: "London, UK",
    description: "Exclusive CTO and VP Engineering summit. Technical founders and engineering leaders from top startups.",
    category: "networking",
  },
  {
    id: "founders-factory-demo-day-2026",
    name: "Founders Factory Demo Day",
    url: "https://foundersfactory.com",
    location: "London, UK",
    description: "Accelerator demo day. Early-stage founders present to 200+ investors.",
    category: "demo-day",
  },
  {
    id: "london-founders-summit-2026",
    name: "London Founders Summit",
    url: "https://londonfounders.io",
    location: "London, UK",
    description: "Curated founder summit bringing together 300+ startup founders in London for networking and talks.",
    category: "networking",
  },
  {
    id: "saas-north-2026",
    name: "SaaS North",
    url: "https://www.saasnorth.com",
    location: "Ottawa, Canada",
    description: "Canada's largest SaaS conference. SaaS founders, operators, and investors.",
    category: "accelerator",
  },
  {
    id: "saastock-2026",
    name: "SaaStock",
    url: "https://www.saastock.com",
    location: "Dublin, Ireland",
    description: "Europe's largest B2B SaaS conference. 4,000+ SaaS founders and executives.",
    category: "accelerator",
  },
  {
    id: "web-summit-qatar-2026",
    name: "Web Summit Qatar",
    url: "https://qatar.websummit.com",
    location: "Doha, Qatar",
    description: "Web Summit's Middle East edition. International founders, deep tech, and investor networking.",
    category: "networking",
  },
  {
    id: "emerge-2026",
    name: "Emerge Conference",
    url: "https://emerge.tech",
    location: "Minsk / Remote",
    description: "Technology and founder conference. AI, deep tech, and frontier technology startups.",
    category: "networking",
  },
  {
    id: "techbb-2026",
    name: "TechBBQ",
    url: "https://techbbq.dk",
    location: "Copenhagen, Denmark",
    description: "Scandinavia's largest startup summit. 8,000+ founders, investors, and tech leaders.",
    category: "accelerator",
  },
  {
    id: "how-to-web-2026",
    name: "How to Web",
    url: "https://www.howtoweb.co",
    location: "Bucharest, Romania",
    description: "CEE's top startup and technology conference. Founders, investors, and innovators from 50+ countries.",
    category: "accelerator",
  },
  {
    id: "eu-innovation-week-2026",
    name: "EU Innovation Week",
    url: "https://ec.europa.eu",
    location: "Brussels, Belgium",
    description: "European Commission innovation and startup policy summit. Deep tech founders and EU funding.",
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
