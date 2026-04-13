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
  // Arctic15 — defined with knownDate later in the array
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
  // Oslo Innovation Week — defined with knownDate later in the array
  // ── Western & Central Europe ───────────────────
  // Web Summit Lisbon — defined with knownDate later in the array
  // Wolves Summit — defined with knownDate later in the array
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
  // TNW, NOAH, TOA, VivaTech, Sifted — defined with knownDates later in the array
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
  // Bits & Pretzels — defined with knownDate later in the array
  // Pirate Summit, South Summit — defined with knownDates later in the array
  {
    id: "pioneers-festival-2026",
    name: "Pioneers Festival",
    url: "https://pioneerfestival.at",
    location: "Vienna, Austria",
    description: "Central European startup festival with pitch competition and investor matchmaking.",
    category: "pitch",
  },
  {
    id: "websummit-rio-2026",
    name: "Web Summit Rio",
    url: "https://rio.websummit.com",
    location: "Rio de Janeiro, Brazil",
    knownDate: "2026-05-04T09:00:00Z",
    knownEndDate: "2026-05-07T18:00:00Z",
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
  // Collision & TechCrunch Disrupt — defined with knownDates later in the array
  {
    id: "rise-conf-2026",
    name: "RISE Conference",
    url: "https://riseconf.com",
    location: "Hong Kong",
    knownDate: "2026-08-26T09:00:00Z",
    knownEndDate: "2026-08-28T18:00:00Z",
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
  // Founders Forum — defined with knownDate later in the array
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
  // Turing Fest — defined with knownDate later in the array
  {
    id: "unicorn-bakery-summit-2026",
    name: "Unicorn Bakery Live Summit",
    url: "https://www.unicornbakery.de",
    location: "Berlin, Germany",
    description: "Top German-language founder podcast live event. International founders, VCs, and operators.",
    category: "networking",
  },
  // Seedstars — defined with knownDate later in the array
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
  // Unbound London — defined with knownDate later in the array
  {
    id: "wired-summit-2026",
    name: "WIRED Summit",
    url: "https://www.wired.co.uk",
    location: "London, UK",
    description: "WIRED magazine flagship event. Tech founders, researchers, and industry leaders.",
    category: "networking",
  },
  // CTO Summit London — defined with knownDate (as CTO Craft) later in the array
  // Founders Factory Demo Day — defined with knownDate later in the array
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
  // SaaStock, Web Summit Qatar, TechBBQ, How to Web — defined with knownDates later in the array
  {
    id: "emerge-2026",
    name: "Emerge Conference",
    url: "https://emerge.tech",
    location: "Minsk / Remote",
    description: "Technology and founder conference. AI, deep tech, and frontier technology startups.",
    category: "networking",
  },
  {
    id: "eu-innovation-week-2026",
    name: "EU Innovation Week",
    url: "https://ec.europa.eu",
    location: "Brussels, Belgium",
    description: "European Commission innovation and startup policy summit. Deep tech founders and EU funding.",
    category: "networking",
  },
  // ── Additional conferences (2026) ──────────────
  {
    id: "websummit-lisbon-2026",
    name: "Web Summit Lisbon",
    url: "https://websummit.com",
    location: "Lisbon, Portugal",
    knownDate: "2026-11-02T09:00:00Z",
    knownEndDate: "2026-11-05T18:00:00Z",
    description: "70,000+ attendees. World's largest tech conference. Major international founder pipeline.",
    category: "networking",
  },
  {
    id: "arctic15-helsinki-2026",
    name: "Arctic15",
    url: "https://arctic15.com",
    location: "Helsinki, Finland",
    knownDate: "2026-06-04T09:00:00Z",
    knownEndDate: "2026-06-05T18:00:00Z",
    description: "Nordic startup matchmaking conference. 1,500+ investors and founders. AI-powered meeting scheduler.",
    category: "fundraising",
  },
  {
    id: "tnw-amsterdam-2026",
    name: "TNW Conference",
    url: "https://thenextweb.com/conference",
    location: "Amsterdam, Netherlands",
    knownDate: "2026-06-18T09:00:00Z",
    knownEndDate: "2026-06-19T18:00:00Z",
    description: "15,000+ attendees. Europe's leading tech festival. Startup programs, investor matchmaking.",
    category: "networking",
  },
  {
    id: "vivatech-paris-2026",
    name: "Viva Technology",
    url: "https://vivatechnology.com",
    location: "Paris, France",
    knownDate: "2026-06-17T09:00:00Z",
    knownEndDate: "2026-06-20T18:00:00Z",
    description: "150,000+ attendees. Europe's biggest startup and tech event. Challenge prizes, investor sessions.",
    category: "networking",
  },
  {
    id: "noah-berlin-2026",
    name: "NOAH Conference Berlin",
    url: "https://noah-conference.com",
    location: "Berlin, Germany",
    knownDate: "2026-06-10T09:00:00Z",
    knownEndDate: "2026-06-11T18:00:00Z",
    description: "1,200+ CEOs, 600+ investors. Premier European digital economy conference. 1:1 investor meetings.",
    category: "fundraising",
  },
  {
    id: "wolves-summit-2026",
    name: "Wolves Summit",
    url: "https://wolvessummit.com",
    location: "Warsaw, Poland",
    knownDate: "2026-10-14T09:00:00Z",
    knownEndDate: "2026-10-16T18:00:00Z",
    description: "Central & Eastern European startup conference. 2,500+ participants, 500+ investors.",
    category: "accelerator",
  },
  {
    id: "south-summit-madrid-2026",
    name: "South Summit Madrid",
    url: "https://www.southsummit.co",
    location: "Madrid, Spain",
    knownDate: "2026-06-03T09:00:00Z",
    knownEndDate: "2026-06-05T18:00:00Z",
    description: "10,000+ attendees. Southern Europe's top startup competition. 100 selected startups pitch.",
    category: "pitch",
  },
  {
    id: "pirate-summit-cologne-2026",
    name: "Pirate Summit",
    url: "https://piratesummit.com",
    location: "Cologne, Germany",
    knownDate: "2026-06-24T09:00:00Z",
    knownEndDate: "2026-06-25T18:00:00Z",
    description: "600+ founders and investors. Early-stage pitch competition and unconference format.",
    category: "pitch",
  },
  {
    id: "tech-open-air-berlin-2026",
    name: "Tech Open Air (TOA) Berlin",
    url: "https://toa.berlin",
    location: "Berlin, Germany",
    knownDate: "2026-07-08T09:00:00Z",
    knownEndDate: "2026-07-10T18:00:00Z",
    description: "Berlin's interdisciplinary tech festival. 5,000+ founders, artists, scientists.",
    category: "networking",
  },
  {
    id: "4yfn-barcelona-2026",
    name: "4YFN (Four Years From Now)",
    url: "https://www.4yfn.com",
    location: "Barcelona, Spain",
    knownDate: "2026-03-02T09:00:00Z",
    knownEndDate: "2026-03-05T18:00:00Z",
    description: "At MWC. 30,000+ attendees, 1,000+ startups. Pitch stages and investor meetings.",
    category: "pitch",
  },
  {
    id: "web3-summit-berlin-2026",
    name: "Web3 Summit",
    url: "https://web3summit.com",
    location: "Berlin, Germany",
    description: "Decentralized web builders conference. Protocol developers, crypto founders, VCs.",
    category: "networking",
  },
  {
    id: "dublin-tech-summit-2026",
    name: "Dublin Tech Summit",
    url: "https://dublintechsummit.tech",
    location: "Dublin, Ireland",
    knownDate: "2026-05-28T09:00:00Z",
    knownEndDate: "2026-05-29T18:00:00Z",
    description: "10,000+ attendees. Ireland's international tech conference. Startup village, pitch arena.",
    category: "networking",
  },
  {
    id: "saastock-dublin-2026",
    name: "SaaStock Dublin",
    url: "https://www.saastock.com",
    location: "Dublin, Ireland",
    knownDate: "2026-10-13T09:00:00Z",
    knownEndDate: "2026-10-15T18:00:00Z",
    description: "4,000+ B2B SaaS founders, execs, investors. Europe's largest SaaS conference.",
    category: "accelerator",
  },
  {
    id: "techbbq-copenhagen-2026",
    name: "TechBBQ",
    url: "https://techbbq.dk",
    location: "Copenhagen, Denmark",
    knownDate: "2026-09-16T09:00:00Z",
    knownEndDate: "2026-09-17T18:00:00Z",
    description: "8,000+ attendees. Scandinavia's largest startup summit. Pitch competition, investor day.",
    category: "accelerator",
  },
  {
    id: "how-to-web-bucharest-2026",
    name: "How to Web",
    url: "https://www.howtoweb.co",
    location: "Bucharest, Romania",
    knownDate: "2026-10-28T09:00:00Z",
    knownEndDate: "2026-10-29T18:00:00Z",
    description: "2,500+ attendees from 50+ countries. CEE's top startup and technology conference.",
    category: "accelerator",
  },
  {
    id: "turing-fest-edinburgh-2026",
    name: "Turing Fest",
    url: "https://www.turingfest.com",
    location: "Edinburgh, UK",
    knownDate: "2026-06-25T09:00:00Z",
    knownEndDate: "2026-06-26T18:00:00Z",
    description: "Startup leadership festival. Founders, CTOs, product leaders share scaling stories.",
    category: "accelerator",
  },
  {
    id: "seedstars-lausanne-2026",
    name: "Seedstars World Summit",
    url: "https://www.seedstars.com",
    location: "Lausanne, Switzerland",
    knownDate: "2026-04-23T09:00:00Z",
    knownEndDate: "2026-04-24T18:00:00Z",
    description: "Global emerging market founders. Pitch competition final with $500K+ in prizes.",
    category: "pitch",
  },
  {
    id: "startup-olé-salamanca-2026",
    name: "Startup Olé",
    url: "https://startupole.eu",
    location: "Salamanca, Spain",
    knownDate: "2026-09-08T09:00:00Z",
    knownEndDate: "2026-09-10T18:00:00Z",
    description: "European startup accelerator summit. 3,000+ startups, investors, corporates.",
    category: "accelerator",
  },
  {
    id: "greentech-festival-berlin-2026",
    name: "Greentech Festival",
    url: "https://greentechfestival.com",
    location: "Berlin, Germany",
    knownDate: "2026-05-13T09:00:00Z",
    knownEndDate: "2026-05-15T18:00:00Z",
    description: "Climate tech and sustainability startup conference. GREEN AWARDS for startups.",
    category: "networking",
  },
  {
    id: "digitalk-sofia-2026",
    name: "DigitalK",
    url: "https://digitalk.bg",
    location: "Sofia, Bulgaria",
    knownDate: "2026-05-20T09:00:00Z",
    knownEndDate: "2026-05-21T18:00:00Z",
    description: "Southeast Europe's top digital and tech conference. 2,000+ attendees, startup track.",
    category: "networking",
  },
  {
    id: "unbound-london-2026",
    name: "Unbound London",
    url: "https://www.unboundglobal.com",
    location: "London, UK",
    knownDate: "2026-07-07T09:00:00Z",
    knownEndDate: "2026-07-08T18:00:00Z",
    description: "Innovation festival. 5,000+ founders, investors, and corporate innovators.",
    category: "networking",
  },
  {
    id: "founders-forum-london-2026",
    name: "Founders Forum",
    url: "https://ff.co",
    location: "London, UK",
    knownDate: "2026-06-18T09:00:00Z",
    knownEndDate: "2026-06-19T18:00:00Z",
    description: "Invite-only gathering of world's top 500 tech founders and CEOs.",
    category: "networking",
  },
  {
    id: "rise-of-ai-berlin-2026",
    name: "Rise of AI Conference",
    url: "https://riseof.ai",
    location: "Berlin, Germany",
    knownDate: "2026-05-14T09:00:00Z",
    knownEndDate: "2026-05-15T18:00:00Z",
    description: "AI founders, researchers, and enterprise leaders. Deep tech AI startup showcase.",
    category: "networking",
  },
  {
    id: "thought-leaders-zurich-2026",
    name: "Thought Leaders Summit Zurich",
    url: "https://thoughtleaderssummit.ch",
    location: "Zurich, Switzerland",
    description: "Swiss tech and innovation summit. Founders, VCs, and corporate innovation leaders.",
    category: "networking",
  },
  {
    id: "superreturn-berlin-2026",
    name: "SuperReturn International",
    url: "https://informaconnect.com/superreturn-international/",
    location: "Berlin, Germany",
    knownDate: "2026-06-02T09:00:00Z",
    knownEndDate: "2026-06-05T18:00:00Z",
    description: "4,000+ private equity and VC investors. Premier European PE/VC conference.",
    category: "fundraising",
  },
  {
    id: "oiw-oslo-2026",
    name: "Oslo Innovation Week",
    url: "https://oiw.no",
    location: "Oslo, Norway",
    knownDate: "2026-09-22T09:00:00Z",
    knownEndDate: "2026-09-26T18:00:00Z",
    description: "Norway's premier innovation festival. 200+ events across Oslo. Startup competitions.",
    category: "networking",
  },
  {
    id: "riga-tech-conf-2026",
    name: "Riga TechConf",
    url: "https://rigatechconf.com",
    location: "Riga, Latvia",
    description: "Baltic's leading tech conference. 800+ attendees, startup founders and VCs.",
    category: "networking",
  },
  {
    id: "login-vilnius-2026",
    name: "LOGIN Conference",
    url: "https://login.lt",
    location: "Vilnius, Lithuania",
    knownDate: "2026-05-14T09:00:00Z",
    knownEndDate: "2026-05-15T18:00:00Z",
    description: "Baltic region's largest tech conference. 4,000+ attendees, startup battlefield.",
    category: "networking",
  },
  {
    id: "silicon-slopes-summit-2026",
    name: "Silicon Slopes Summit",
    url: "https://www.siliconslopes.com/summit",
    location: "Salt Lake City, USA",
    knownDate: "2026-10-15T09:00:00Z",
    knownEndDate: "2026-10-16T18:00:00Z",
    description: "20,000+ attendees. Utah tech ecosystem conference. Founders, VCs, and enterprise tech.",
    category: "networking",
  },
  {
    id: "innotribe-2026",
    name: "Sibos / Innotribe",
    url: "https://www.swift.com/sibos",
    location: "Dubai, UAE",
    knownDate: "2026-10-12T09:00:00Z",
    knownEndDate: "2026-10-15T18:00:00Z",
    description: "Global fintech conference by SWIFT. 10,000+ attendees. Fintech founder showcase.",
    category: "networking",
  },
  {
    id: "sifted-summit-london-2026",
    name: "Sifted Summit",
    url: "https://sifted.eu/events",
    location: "London, UK",
    knownDate: "2026-10-08T09:00:00Z",
    knownEndDate: "2026-10-08T18:00:00Z",
    description: "European startup media summit by FT. 1,500+ founders, VCs, and operators.",
    category: "networking",
  },
  {
    id: "founders-factory-demo-2026",
    name: "Founders Factory Demo Day",
    url: "https://foundersfactory.com",
    location: "London, UK",
    knownDate: "2026-07-15T17:00:00Z",
    knownEndDate: "2026-07-15T21:00:00Z",
    description: "Accelerator demo day. Early-stage founders present to 200+ investors.",
    category: "demo-day",
  },
  {
    id: "cto-craft-london-2026",
    name: "CTO Craft Conference",
    url: "https://ctocraft.com/conference",
    location: "London, UK",
    knownDate: "2026-05-06T09:00:00Z",
    knownEndDate: "2026-05-07T18:00:00Z",
    description: "400+ CTOs and VP Engineering. Technical leadership, scaling teams, startup CTO tracks.",
    category: "networking",
  },
  {
    id: "productcon-london-2026",
    name: "ProductCon London",
    url: "https://www.productschool.com/productcon",
    location: "London, UK",
    knownDate: "2026-09-09T09:00:00Z",
    knownEndDate: "2026-09-09T18:00:00Z",
    description: "3,000+ product managers and founders. Product leadership conference.",
    category: "networking",
  },
  {
    id: "web-summit-qatar-doha-2026",
    name: "Web Summit Qatar",
    url: "https://qatar.websummit.com",
    location: "Doha, Qatar",
    knownDate: "2026-02-11T09:00:00Z",
    knownEndDate: "2026-02-13T18:00:00Z",
    description: "Web Summit's Middle East edition. 15,000+ attendees. International founders and investors.",
    category: "networking",
  },
  // ── Additional 2026 conferences ────────────────
  {
    id: "saastr-annual-2026",
    name: "SaaStr Annual 2026",
    url: "https://www.saastrannual.com",
    location: "San Francisco, USA",
    knownDate: "2026-09-15T09:00:00Z",
    knownEndDate: "2026-09-17T18:00:00Z",
    description: "15,000+ SaaS founders, operators, and investors. Largest SaaS-focused event globally.",
    category: "accelerator",
  },
  {
    id: "gitex-global-2026",
    name: "GITEX Global 2026",
    url: "https://www.gitex.com",
    location: "Dubai, UAE",
    knownDate: "2026-10-14T09:00:00Z",
    knownEndDate: "2026-10-18T18:00:00Z",
    description: "World's largest tech event. 200,000+ attendees, 6,500+ startups. Global founder and investor pipeline.",
    category: "networking",
  },
  {
    id: "singapore-fintech-festival-2026",
    name: "Singapore FinTech Festival 2026",
    url: "https://www.fintechfestival.sg",
    location: "Singapore",
    knownDate: "2026-11-10T09:00:00Z",
    knownEndDate: "2026-11-12T18:00:00Z",
    description: "World's largest fintech festival. 65,000+ attendees from 150+ countries. Startup pitches and investor matchmaking.",
    category: "networking",
  },
  {
    id: "venture-atlanta-2026",
    name: "Venture Atlanta 2026",
    url: "https://ventureatlanta.org",
    location: "Atlanta, USA",
    knownDate: "2026-10-22T09:00:00Z",
    knownEndDate: "2026-10-23T18:00:00Z",
    description: "Southeast US's premier startup investment conference. Founders pitch to top-tier investors.",
    category: "pitch",
  },
  {
    id: "africarena-2026",
    name: "AfricArena 2026",
    url: "https://www.africarena.com",
    location: "Cape Town, South Africa",
    knownDate: "2026-11-18T09:00:00Z",
    knownEndDate: "2026-11-19T18:00:00Z",
    description: "Africa's leading tech and startup summit. 2,000+ attendees, 200+ startups, international investors.",
    category: "pitch",
  },
  // ── 2027 conferences ───────────────────────────
  {
    id: "ces-2027",
    name: "CES 2027",
    url: "https://www.ces.tech",
    location: "Las Vegas, USA",
    knownDate: "2027-01-06T09:00:00Z",
    knownEndDate: "2027-01-09T18:00:00Z",
    description: "World's most influential tech event. 175,000+ attendees, 4,000+ exhibitors. Deep tech and startup showcase.",
    category: "networking",
  },
  {
    id: "techchill-2027",
    name: "TechChill 2027",
    url: "https://techchill.co",
    location: "Riga, Latvia",
    knownDate: "2027-02-20T09:00:00Z",
    knownEndDate: "2027-02-21T18:00:00Z",
    description: "Baltic startup conference. Founders, investors, and accelerators from across Northern Europe.",
    category: "accelerator",
  },
  {
    id: "mwc-2027",
    name: "MWC Barcelona 2027",
    url: "https://www.mwcbarcelona.com",
    location: "Barcelona, Spain",
    knownDate: "2027-02-28T09:00:00Z",
    knownEndDate: "2027-03-03T18:00:00Z",
    description: "100,000+ attendees. World's largest mobile and tech event. 4YFN startup village.",
    category: "networking",
  },
  {
    id: "sxsw-2027",
    name: "SXSW 2027",
    url: "https://www.sxsw.com",
    location: "Austin, USA",
    knownDate: "2027-03-14T09:00:00Z",
    knownEndDate: "2027-03-22T18:00:00Z",
    description: "70,000+ attendees. Music, film, tech and startup convergence. Major founder networking.",
    category: "networking",
  },
  {
    id: "startup-grind-global-2027",
    name: "Startup Grind Global Conference 2027",
    url: "https://www.startupgrind.com/conference",
    location: "Silicon Valley, USA",
    knownDate: "2027-04-15T09:00:00Z",
    knownEndDate: "2027-04-16T18:00:00Z",
    description: "400+ VC funds, proven mentors. Tactical education on fundraising, product, and scaling.",
    category: "accelerator",
  },
  {
    id: "collision-2027",
    name: "Collision Conference 2027",
    url: "https://collisionconf.com",
    location: "Toronto, Canada",
    knownDate: "2027-06-23T09:00:00Z",
    knownEndDate: "2027-06-25T18:00:00Z",
    description: "North America's fastest-growing tech conference. Strong international founder attendance.",
    category: "networking",
  },
  {
    id: "london-tech-week-2027",
    name: "London Tech Week 2027",
    url: "https://londontechweek.com",
    location: "London, UK",
    knownDate: "2027-06-09T09:00:00Z",
    knownEndDate: "2027-06-13T18:00:00Z",
    description: "London's flagship tech festival. 50,000+ attendees across hundreds of events.",
    category: "networking",
  },
  {
    id: "vivatech-2027",
    name: "VivaTech 2027",
    url: "https://vivatechnology.com",
    location: "Paris, France",
    knownDate: "2027-06-11T09:00:00Z",
    knownEndDate: "2027-06-14T18:00:00Z",
    description: "150,000+ attendees. Europe's biggest startup and tech event. Challenge prizes and investor sessions.",
    category: "networking",
  },
  {
    id: "saastr-annual-2027",
    name: "SaaStr Annual 2027",
    url: "https://www.saastrannual.com",
    location: "San Francisco, USA",
    knownDate: "2027-09-15T09:00:00Z",
    knownEndDate: "2027-09-17T18:00:00Z",
    description: "15,000+ SaaS founders, operators, and investors. Largest SaaS-focused event globally.",
    category: "accelerator",
  },
  {
    id: "techcrunch-disrupt-2027",
    name: "TechCrunch Disrupt 2027",
    url: "https://techcrunch.com/events/disrupt",
    location: "San Francisco, USA",
    knownDate: "2027-10-20T09:00:00Z",
    knownEndDate: "2027-10-22T18:00:00Z",
    description: "Premier startup launch conference. Startup battlefield, 10,000+ attendees.",
    category: "pitch",
  },
  {
    id: "websummit-lisbon-2027",
    name: "Web Summit 2027",
    url: "https://websummit.com",
    location: "Lisbon, Portugal",
    knownDate: "2027-11-03T09:00:00Z",
    knownEndDate: "2027-11-06T18:00:00Z",
    description: "70,000+ attendees. World's largest tech conference. Major international founder pipeline.",
    category: "networking",
  },
  {
    id: "slush-2027",
    name: "Slush 2027",
    url: "https://www.slush.org",
    location: "Helsinki, Finland",
    knownDate: "2027-11-20T09:00:00Z",
    knownEndDate: "2027-11-21T18:00:00Z",
    description: "Europe's leading startup event. 13,000+ attendees, 4,000+ startups, 2,000+ investors.",
    category: "accelerator",
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
