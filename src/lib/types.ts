export interface FounderEvent {
  id: string;
  title: string;
  description: string;
  date: string; // ISO string
  endDate?: string;
  location: string;
  url: string; // RSVP link
  source: "eventbrite" | "luma" | "partiful" | "meetup";
  category: string; // hackathon, demo-day, networking, pitch, etc.
  imageUrl?: string;
  // Expedite lead quality scoring
  leadScore?: number;    // 0–100: how likely this event has founders who need O-1A visas
  leadTier?: "hot" | "warm" | "cold";
  highLeverage?: boolean; // true = Expedite should attend / reach out to attendees
  leverageReason?: string; // short explanation why it's high leverage
  // Organizer info
  organizerName?: string;
  organizerLumaId?: string;
  organizerLinkedin?: string;
  organizerUsername?: string;
  organizerAvatarUrl?: string;
  organizerWebsite?: string;
}

// ---------------------------------------------------------------------------
// Expedite Lead Quality Scoring
//
// Purpose: identify events where European/international founders are actively
// building, pitching, or fundraising — and would benefit from O-1A visa help
// to expand to the US.
//
// High leverage = Expedite should be in the room or DM'ing attendees.
// ---------------------------------------------------------------------------

export interface LeadScore {
  score: number;
  tier: "hot" | "warm" | "cold";
  highLeverage: boolean;
  leverageReason: string;
}

// ---------------------------------------------------------------------------
// HOT (80+): Founders in decision mode RIGHT NOW
// ---------------------------------------------------------------------------
const HOT_CRITERIA: Array<{ score: number; reason: string; keywords: string[] }> = [
  {
    score: 98,
    reason: "Accelerator demo day — graduating founders seeking investment & US expansion",
    keywords: [
      "demo day", "demo night", "batch demo", "cohort demo", "graduation demo",
      "yc demo", "techstars demo", "antler demo", "ef demo",
      "entrepreneur first demo", "pioneer tournament",
    ],
  },
  {
    score: 92,
    reason: "US expansion / immigration event — founders thinking about the US right now",
    keywords: [
      "us expansion", "us market", "expanding to us", "go to market us",
      "silicon valley", "san francisco", "bay area founder",
      "transatlantic", "us launch", "american market", "us fundraising",
      "global ambition", "international expansion",
      "relocation", "moving to us",
    ],
  },
  {
    score: 90,
    reason: "Top-tier accelerator event — international cohort, US-focused founders",
    keywords: [
      "y combinator", "yc batch", "yc alum", "techstars", "entrepreneur first",
      "antler", "ef london", "ef berlin", "ef paris", "zinc vc",
      "a16z", "sequoia", "index ventures", "balderton", "atomico",
      "notion capital", "seedcamp", "cherry ventures", "point nine",
      "rocket internet", "station f", "deep tech labs",
    ],
  },
  {
    score: 88,
    reason: "Investor pitch event — founders presenting to investors, high US ambition",
    keywords: [
      "pitch competition", "pitch battle", "pitch contest", "startup pitch",
      "pitch night", "pitch day", "pitch event", "founder pitch",
      "pitch me baby", "investor pitch", "startup competition",
    ],
  },
  {
    score: 85,
    reason: "International founder summit — global founders gathering",
    keywords: [
      "international founder", "founder summit", "global founder summit",
      "european founder summit", "founder conference", "founders conference",
    ],
  },
  {
    score: 87,
    reason: "Exclusive founder breakfast/dinner — intimate, invite-only setting with decision-makers",
    keywords: [
      "founder breakfast", "founder dinner", "ceo breakfast", "cto breakfast",
      "ceo dinner", "cto dinner", "investor breakfast", "investor dinner",
      "founders dinner", "founders breakfast", "startup breakfast",
      "invite-only breakfast", "invite-only dinner", "private dinner",
      "vc dinner", "vc breakfast",
    ],
  },
];

// ---------------------------------------------------------------------------
// WARM - VC tier (70-79): VCs who refer founders
// ---------------------------------------------------------------------------
const WARM_VC_CRITERIA: Array<{ score: number; reason: string; keywords: string[] }> = [
  {
    score: 78,
    reason: "VC / investor networking — funded or fundraising founders present",
    keywords: [
      "investor meetup", "vc networking", "venture capital", "angel investor",
      "angel network", "seed stage", "pre-seed", "series a", "series b",
      "fundraising event", "limited partner", "general partner",
      "vc summit", "investor day",
    ],
  },
  {
    score: 75,
    reason: "Portfolio founder event — VC-backed founders in the room",
    keywords: [
      "portfolio founders", "backed founders", "portfolio company",
      "portfolio event", "lp event",
    ],
  },
  {
    score: 72,
    reason: "Fundraising / LP/GP event — founders in fundraise mode",
    keywords: [
      "fundraising", "fundraise", "lp/gp", "gp lp", "raise capital",
      "growth capital", "investor roundtable",
    ],
  },
];

// ---------------------------------------------------------------------------
// WARM - Founder adjacent (60-69): Builders likely to be founders
// ---------------------------------------------------------------------------
const WARM_FOUNDER_CRITERIA: Array<{ score: number; reason: string; keywords: string[] }> = [
  {
    score: 68,
    reason: "AI summit / frontier AI conference — high density of technical founders",
    keywords: [
      "ai summit", "ai conference", "ai forum", "ai festival",
      "ml summit", "llm summit", "machine learning conference",
      "deep learning summit", "federated learning", "agentic ai",
      "generative ai summit", "gen ai summit", "open source ai",
      "flower ai", "neurips", "iclr", "icml", "cvpr",
      "ai founders summit", "ai startup summit",
    ],
  },
  {
    score: 66,
    reason: "Hackathon / buildathon — ambitious builders, many are founders or pre-founders",
    keywords: [
      "hackathon", "buildathon", "hack day", "build weekend",
      "startup weekend", "ai hackathon", "fintech hackathon", "web3 hackathon",
    ],
  },
  {
    score: 64,
    reason: "Accelerator community event — early-stage international founders",
    keywords: [
      "accelerator", "incubator", "founder community", "startup showcase",
      "startup program", "cohort", "scale-up", "scaleup",
      "growth stage", "b2b saas founders", "saas founders",
      "founder retreat", "cto summit", "ceo summit",
    ],
  },
  {
    score: 62,
    reason: "Deep tech / PhD founder event — extraordinary ability O-1A profiles",
    keywords: [
      "deep tech", "deeptech", "phd founder", "scientist founder",
      "research startup", "research commercialisation",
    ],
  },
  {
    score: 65,
    reason: "Tech breakfast / dinner — curated community events with founders",
    keywords: [
      "tech breakfast", "tech dinner", "startup dinner", "startup breakfast",
      "morning breakfast", "breakfast event", "founder brunch", "dinner event",
    ],
  },
  {
    score: 60,
    reason: "Tech summit / conference — broad founder and investor attendance",
    keywords: [
      "tech summit", "startup summit", "innovation summit",
      "web summit", "tech conference", "startup conference",
      "innovation conference", "fintech summit", "climate tech summit",
      "healthtech summit", "proptech summit",
    ],
  },
];

// ---------------------------------------------------------------------------
// COLD (40-55): Startup ecosystem, indirect path to founders
// ---------------------------------------------------------------------------
const COLD_CRITERIA: Array<{ score: number; reason: string; keywords: string[] }> = [
  {
    score: 55,
    reason: "Startup networking — general crowd with meaningful founder presence",
    keywords: [
      "startup networking", "founder networking", "tech networking",
      "entrepreneur networking", "founder meetup",
      "startup meetup", "tech drinks", "tech social",
    ],
  },
  {
    score: 50,
    reason: "Tech meetup — developer community with potential founders",
    keywords: [
      "tech meetup", "developer meetup", "engineer meetup",
      "tech talk", "tech event",
    ],
  },
  {
    score: 48,
    reason: "Workshop / masterclass — builders upskilling",
    keywords: [
      "workshop", "masterclass", "bootcamp", "hands-on",
      "training session", "tech workshop", "coding workshop",
      "ai workshop", "data workshop", "product workshop",
    ],
  },
  {
    score: 46,
    reason: "Panel / fireside chat — thought leadership with founders present",
    keywords: [
      "panel discussion", "fireside chat", "roundtable", "town hall",
      "tech panel", "founder fireside", "leadership talk",
    ],
  },
  {
    score: 45,
    reason: "GTM / growth / operator event — indirect path to founders",
    keywords: [
      "gtm breakfast", "gtm dinner", "go-to-market", "growth hacking",
      "demand gen", "revenue ops", "operator event", "operator dinner",
      "sales meetup", "marketing meetup",
    ],
  },
  {
    score: 43,
    reason: "Launch / showcase event — new products and companies launching",
    keywords: [
      "launch party", "launch event", "product launch", "launch night",
      "launch celebration", "beta launch", "grand opening",
    ],
  },
  {
    score: 42,
    reason: "Marketing / growth event",
    keywords: [
      "gtm", "growth hacking", "demand gen", "revenue ops",
      "marketing event", "growth event",
    ],
  },
  {
    score: 40,
    reason: "Innovation / digital transformation event",
    keywords: [
      "innovation", "digital transformation", "future of work",
      "future of tech", "emerging tech", "new technology",
      "disruption", "disruptive",
    ],
  },
  {
    score: 38,
    reason: "General tech community event",
    keywords: [
      "product hunt", "indie hacker", "side project", "maker",
      "open source", "developer community", "tech community",
      "coworking event", "co-working", "hub event",
    ],
  },
  {
    score: 35,
    reason: "Industry / sector event — potential founder crossover",
    keywords: [
      "fintech event", "healthtech event", "edtech event", "proptech event",
      "climate tech event", "clean tech", "biotech event", "medtech",
      "insurtech", "regtech", "legaltech", "agritech", "foodtech",
      "mobility", "smart city", "sustainability",
    ],
  },
];

// ---------------------------------------------------------------------------
// High-leverage boost signals (applied on top of base score)
// ---------------------------------------------------------------------------
const LEVERAGE_BOOSTS: Array<{ bonus: number; reason: string; keywords: string[] }> = [
  {
    bonus: 10,
    reason: "International / European founder angle",
    keywords: [
      "international founder", "european founder", "global founder",
      "non-us founder", "cross-border", "european startup",
      "french startup", "german startup", "british startup",
      "nordic startup", "uk startup",
    ],
  },
  {
    bonus: 8,
    reason: "AI / deep tech focus — extraordinary ability profile for O-1A",
    keywords: [
      "ai founder", "ai startup", "deep tech", "frontier ai",
      "machine learning startup", "research commercialisation",
      "phd founder", "scientist founder", "research startup",
      "federated learning", "agentic ai", "open source ai",
      "llm startup", "generative ai", "foundation model",
    ],
  },
  {
    bonus: 5,
    reason: "High-profile judges / panel — judging criteria signal for O-1A",
    keywords: [
      "judging panel", "jury", "judges", "judged by", "award ceremony",
      "startup award", "innovation award", "best startup",
    ],
  },
];

// ---------------------------------------------------------------------------
// Core scoring function
// ---------------------------------------------------------------------------
export function scoreLeadQuality(title: string, description: string): LeadScore {
  const text = `${title} ${description}`.toLowerCase();
  let topScore = 0;
  let topReason = "";

  // Check all criteria groups in order
  const allCriteria = [
    ...HOT_CRITERIA,
    ...WARM_VC_CRITERIA,
    ...WARM_FOUNDER_CRITERIA,
    ...COLD_CRITERIA,
  ];

  for (const c of allCriteria) {
    if (c.keywords.some((kw) => text.includes(kw)) && c.score > topScore) {
      topScore = c.score;
      topReason = c.reason;
    }
  }

  // Baseline tier 1 (score 30): strong founder/startup signal
  if (topScore === 0) {
    const strongBaseKeywords = [
      "founder", "founders", "startup", "startups", "start-up",
      "entrepreneur", "entrepreneurship", "saas", "fintech", "deeptech",
      "web3", "venture", "vc ", "investor", "pre-seed", "seed stage",
      "series a", "fundrais",
    ];
    if (strongBaseKeywords.some((kw) => text.includes(kw))) {
      topScore = 30;
      topReason = "General founder/startup event";
    }
  }

  // Baseline tier 2 (score 20): tech/innovation signal
  if (topScore === 0) {
    const techBaseKeywords = [
      "tech", "technology", "software", "developer", "engineering",
      "ai ", "artificial intelligence", "machine learning", "data science",
      "cloud", "blockchain", "crypto", "digital", "innovation",
      "product", "design", "ux ", "ui ", "devops", "open source",
      "api ", "platform", "saas", "b2b", "b2c", "marketplace",
      "coding", "programming", "python", "javascript", "react",
      "cybersecurity", "quantum", "robotics", "automation",
      "no-code", "low-code", "app ", "mobile",
    ];
    if (techBaseKeywords.some((kw) => text.includes(kw))) {
      topScore = 20;
      topReason = "Tech/innovation community event";
    }
  }

  // Baseline tier 3 (score 12): any event-like signal from our sources
  if (topScore === 0) {
    const broadBaseKeywords = [
      "meetup", "meet-up", "networking", "conference", "summit",
      "workshop", "hackathon", "panel", "fireside", "pitch",
      "demo", "showcase", "launch", "community", "social",
      "drinks", "mixer", "breakfast", "dinner", "brunch",
      "coworking", "co-working", "hub", "lab ", "accelerat",
      "incubat", "bootcamp", "masterclass", "seminar", "webinar",
      "talk", "speaker", "keynote", "forum", "expo",
      "fair", "festival", "competition", "challenge", "award",
      "business", "enterprise", "corporate", "professional",
      "industry", "sector", "market", "growth", "scale",
    ];
    if (broadBaseKeywords.some((kw) => text.includes(kw))) {
      topScore = 12;
      topReason = "Community / industry event";
    }
  }

  // Apply leverage boosts (additive, capped at 100)
  for (const boost of LEVERAGE_BOOSTS) {
    if (boost.keywords.some((kw) => text.includes(kw))) {
      topScore = Math.min(100, topScore + boost.bonus);
      if (topReason) topReason += ` + ${boost.reason.toLowerCase()}`;
    }
  }

  // HOT = 80+, WARM = 55+, COLD = below 55
  const tier: "hot" | "warm" | "cold" =
    topScore >= 80 ? "hot" : topScore >= 55 ? "warm" : "cold";

  // High leverage: hot tier OR explicit immigration/US-expansion signal
  const highLeverageKeywords = [
    "demo day", "demo night", "pitch competition", "pitch night",
    "us expansion", "us market", "silicon valley",
    "techstars", "antler", "y combinator",
    "entrepreneur first", "investor pitch", "fundraising",
    "founder breakfast", "founder dinner", "ceo breakfast", "ceo dinner",
    "cto breakfast", "cto dinner", "investor breakfast", "investor dinner",
    "founders dinner", "founders breakfast", "invite-only", "vc dinner", "vc breakfast",
  ];
  const highLeverage =
    topScore >= 80 || highLeverageKeywords.some((kw) => text.includes(kw));

  const leverageReason = highLeverage ? topReason : "";

  return { score: topScore, tier, highLeverage, leverageReason };
}

// ---------------------------------------------------------------------------
// Event filtering — what events to scrape at all
// ---------------------------------------------------------------------------
export const EVENT_KEYWORDS = [
  // Core
  "hackathon", "hack day", "buildathon", "demo day", "demo night",
  "pitch night", "pitch competition", "pitch event", "pitch day",
  "founder", "founders", "startup", "startups", "start-up",
  "entrepreneur", "entrepreneurship",
  // Funding
  "fundraising", "fundraise", "investor", "investors", "angel",
  "VC", "venture capital", "venture", "seed", "pre-seed",
  "series A", "series B",
  // Programs
  "accelerator", "incubator", "techstars", "Y Combinator", "YC",
  "antler", "entrepreneur first", "EF", "seedcamp",
  // Tech sectors
  "AI", "artificial intelligence", "machine learning", "fintech",
  "SaaS", "B2B", "web3", "crypto", "blockchain", "deep tech",
  "climate tech", "healthtech", "proptech", "edtech",
  "biotech", "medtech", "insurtech", "regtech", "legaltech",
  "agritech", "foodtech", "cybersecurity", "robotics", "quantum",
  // Tech broadly
  "tech", "technology", "software", "developer", "engineering",
  "data science", "cloud", "digital", "innovation", "product",
  "design", "open source", "devops", "automation", "platform",
  "API", "mobile", "app",
  // Events types
  "launch", "showcase", "networking", "meetup", "meet-up",
  "tech meetup", "fireside chat", "panel", "summit", "conference",
  "workshop", "masterclass", "bootcamp", "seminar", "webinar",
  "talk", "speaker", "keynote", "forum", "expo", "festival",
  "roundtable", "town hall",
  // Expansion signals
  "relocation", "us expansion", "us market",
  // Growth / GTM
  "scale-up", "scaleup", "growth", "gtm", "go-to-market",
  // Community
  "product hunt", "indie hacker", "bootstrapped",
  "silicon roundabout", "tech city", "station f",
  // Social / dining
  "drinks", "social", "community", "breakfast", "dinner", "brunch",
  "mixer", "happy hour",
  // Business
  "business", "enterprise", "professional", "industry",
  "sustainability", "smart city", "future of work",
];

export const CATEGORIES: Record<string, string[]> = {
  hackathon:    ["hackathon", "hack", "buildathon"],
  "demo-day":   ["demo day", "demo night", "showcase"],
  pitch:        ["pitch night", "pitch competition", "pitch event", "pitch day", "pitch battle"],
  "dinner-breakfast": [
    "dinner", "breakfast", "brunch", "supper", "luncheon",
    "founder dinner", "founder breakfast", "ceo dinner", "ceo breakfast",
    "cto dinner", "cto breakfast", "investor dinner", "investor breakfast",
    "vc dinner", "vc breakfast", "startup dinner", "startup breakfast",
    "tech dinner", "tech breakfast",
  ],
  networking:   ["networking", "meetup", "social", "mixer", "drinks", "summit"],
  fundraising:  ["fundraising", "investor", "VC", "venture capital", "seed", "series A", "angel"],
  accelerator:  ["accelerator", "incubator", "techstars", "Y Combinator", "YC", "antler", "seedcamp"],
  workshop:     ["workshop", "masterclass", "bootcamp", "hands-on", "training"],
  general:      ["founder", "startup", "entrepreneur", "tech"],
};

export function categorizeEvent(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    if (category === "general") continue;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) return category;
    }
  }
  return "general";
}

export function isRelevantEvent(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  return EVENT_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}
