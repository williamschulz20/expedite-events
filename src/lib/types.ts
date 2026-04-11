export interface FounderEvent {
  id: string;
  dbId?: string;
  title: string;
  description: string;
  date: string; // ISO string
  endDate?: string;
  location: string;
  url: string; // RSVP link
  source: string;
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
  // Acceptance / attendance tracking
  acceptedAt?: string;
  attendedAt?: string;
}

// ---------------------------------------------------------------------------
// Expedite Lead Quality Scoring — O-1A FOCUSED
//
// Purpose: identify events where international founders, CTOs, and technical
// leaders are actively building, pitching, or fundraising — people who would
// qualify for O-1A visas (Critical Role + Original Contributions priority).
//
// KILL everything that won't convert: art shows, book clubs, DJ nights,
// food events, film screenings, fitness, fashion, cultural, social parties.
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
// BLOCKLIST — instant score 0, these NEVER convert to O-1A clients
// ---------------------------------------------------------------------------
const BLOCKLIST_KEYWORDS: string[] = [
  // Art / creative (non-tech)
  "art exhibition", "art gallery", "art show", "art installation", "art opening",
  "life drawing", "painting class", "pottery", "ceramics", "sculpture",
  "colouring", "coloring", "doodle", "sketching class", "watercolor",
  "art workshop", "art fair", "art walk", "art market", "art festival",
  "open studio", "artist studio", "printmaking",
  // Music / nightlife
  "dj set", "dj night", "live music", "concert", "gig night", "club night",
  "open mic", "karaoke", "jazz night", "hip hop night", "techno night",
  "house music", "drum and bass", "rave", "nightclub", "afterparty",
  "brit pop", "record fair", "vinyl", "music festival", "backstage session",
  "band night", "songwriter", "beatbox", "jam session",
  // Food / drink (non-networking)
  "cookbook", "cooking class", "wine tasting", "wine bar", "beer tasting",
  "food festival", "supper club", "ramen", "brunch club", "bake off",
  "cocktail making", "mixology", "cheese tasting", "coffee tasting",
  "tea tasting", "taco", "pizza making", "sushi making", "chocolate",
  "vegan cooking", "recipe", "bottomless brunch", "bottomless ramen",
  // Film / theater / performance
  "film screening", "movie night", "cinema", "film festival", "short film",
  "theater", "theatre", "comedy show", "stand-up comedy", "improv",
  "drag show", "cabaret", "burlesque", "magic show", "puppet",
  "spoken word", "open mic poetry", "poetry reading", "poetry slam",
  // Sports / fitness
  "yoga", "pilates", "meditation", "mindfulness retreat", "breathwork",
  "running club", "run club", "5k run", "10k run", "marathon", "parkrun",
  "beach volleyball", "football", "basketball", "tennis", "cricket",
  "swimming", "cycling club", "bike ride", "hike", "hiking",
  "climbing", "boxing", "martial arts", "crossfit", "gym",
  "walking club", "hot girl walk", "cold plunge",
  // Fashion / lifestyle
  "sample sale", "fashion show", "fashion week", "clothing swap",
  "vintage market", "flea market", "car boot", "thrift",
  "beauty", "skincare", "makeup", "hair styling", "tattoo",
  "nail art", "perfume", "fragrance", "scent social",
  // Dating / social parties (non-business)
  "speed dating", "singles night", "dating event", "matchmaking",
  "house party", "garden party", "pool party", "rooftop party",
  "block party", "street party", "pop-up party", "pop -up",
  "snow bunny",
  // Spirituality / wellness
  "astrology", "tarot", "crystal healing", "sound bath", "reiki",
  "chakra", "horoscope", "moon circle", "cacao ceremony",
  // Kids / family
  "kids workshop", "children's", "family day", "parenting",
  "baby shower", "birthday party",
  // Crafts / hobbies
  "knitting", "crochet", "embroidery", "sewing class", "candle making",
  "soap making", "flower arranging", "floral", "terrarium",
  "book club", "reading group", "literary salon", "author chat",
  // Religion
  "church service", "prayer meeting", "bible study", "worship",
  // Real estate / property (non-proptech)
  "open house", "property viewing", "house tour",
  // Pet events
  "dog walk", "cat cafe", "pet meetup",
  // Generic social that won't convert
  "mingle", "pub quiz", "trivia night", "game night", "board game",
  "escape room", "treasure hunt", "scavenger hunt",
  "photo walk", "photo salon", "photography walk",
];

// ---------------------------------------------------------------------------
// HOT (80+): Founders in decision mode RIGHT NOW
// O-1A criteria: Critical Role, Original Contributions, Judging, Awards
// ---------------------------------------------------------------------------
const HOT_CRITERIA: Array<{ score: number; reason: string; keywords: string[] }> = [
  {
    score: 98,
    reason: "Accelerator demo day — graduating founders seeking US expansion",
    keywords: [
      "demo day", "demo night", "batch demo", "cohort demo", "graduation demo",
      "yc demo", "techstars demo", "antler demo", "ef demo",
      "entrepreneur first demo", "pioneer tournament",
    ],
  },
  {
    score: 95,
    reason: "Major founder conference — VivaTech/Slush/WebSummit tier",
    keywords: [
      "vivatech", "viva tech", "viva technology",
      "slush", "web summit", "websummit", "tnw conference",
      "collision conf", "techcrunch disrupt", "rise conf",
      "wolves summit", "arctic15", "latitude59", "latitude 59",
      "south summit", "bits & pretzels", "bits and pretzels",
      "noah conference", "pirate summit", "pioneers festival",
      "tech open air", "london tech week", "paris blockchain week",
      "token2049", "ethcc", "money2020", "money20/20",
      "sifted summit", "startup grind global", "startup battlefield",
      "saastanak", "saas tanak",
      "sxsw", "encode london", "developerweek",
      "eu-startups summit", "eu startups summit",
      "hello tomorrow", "gitex europe", "gitex north star",
      "startup grind conference", "startupcon europe",
      "founders forum", "global founders conference",
      "start summit", "startup day tartu", "upstream festival",
      "techcrunch founder summit", "deel pitch", "the pitch by deel",
      "selectusa", "collision conference",
      "founderland", "turing fest", "unicorn bakery",
      "seedstars", "founders pledge", "f.founders", "ffounders",
      "dmexco", "4yfn", "four years from now",
      "unbound london", "unbound global", "wired summit",
      "cto summit", "founders factory", "london founders summit",
      "saastock", "saas north", "techbbq", "tech bbq",
      "how to web", "emerge conference", "emerge tech",
      "web summit qatar",
    ],
  },
  {
    score: 92,
    reason: "US expansion / immigration event — founders thinking about the US right now",
    keywords: [
      "us expansion", "u.s expansion", "u.s. expansion", "us market", "expanding to us", "go to market us",
      "silicon valley", "bay area founder",
      "transatlantic", "us launch", "american market", "us fundraising",
      "global ambition", "international expansion",
      "relocation", "moving to us", "o-1a", "o1a", "visa",
      "immigration", "work permit", "global talent",
    ],
  },
  {
    score: 90,
    reason: "Top-tier accelerator event — international founders with US ambition",
    keywords: [
      "y combinator", "yc batch", "yc alum", "techstars", "entrepreneur first",
      "antler", "ef london", "ef berlin", "ef paris", "zinc vc",
      "a16z", "sequoia", "index ventures", "balderton", "atomico",
      "notion capital", "seedcamp", "cherry ventures", "point nine",
      "station f", "deep tech labs",
    ],
  },
  {
    score: 88,
    reason: "Investor pitch event — founders presenting to raise capital",
    keywords: [
      "pitch competition", "pitch battle", "pitch contest", "startup pitch",
      "pitch night", "pitch day", "pitch event", "founder pitch",
      "pitch me baby", "investor pitch", "startup competition",
      "startup battlefield", "pitch on stage",
    ],
  },
  {
    score: 87,
    reason: "Exclusive founder breakfast/dinner — intimate, invite-only with decision-makers",
    keywords: [
      "founder breakfast", "founder dinner", "founder lunch", "ceo breakfast", "cto breakfast",
      "ceo dinner", "cto dinner", "investor breakfast", "investor dinner",
      "founders dinner", "founders breakfast", "founders lunch", "startup breakfast",
      "invite-only breakfast", "invite-only dinner", "private dinner",
      "vc dinner", "vc breakfast",
    ],
  },
  {
    score: 85,
    reason: "International founder summit — global founders gathering",
    keywords: [
      "international founder", "founder summit", "global founder summit",
      "european founder summit", "founder conference", "founders conference",
      "startup summit", "startup festival",
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
      "portfolio event", "lp event", "dn capital", "general catalyst",
    ],
  },
  {
    score: 72,
    reason: "Fundraising / LP/GP event — founders in fundraise mode",
    keywords: [
      "fundraising", "fundraise", "lp/gp", "gp lp", "raise capital",
      "growth capital", "investor roundtable", "cap table",
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
      "ai summit", "ai conference", "ai forum",
      "ml summit", "llm summit", "machine learning conference",
      "deep learning summit", "agentic ai",
      "generative ai summit", "gen ai summit",
      "flower ai", "neurips", "iclr", "icml", "cvpr",
      "ai founders", "ai startup summit",
    ],
  },
  {
    score: 66,
    reason: "Hackathon — ambitious builders, founders, and pre-founders",
    keywords: [
      "hackathon", "buildathon", "hack day", "build weekend",
      "startup weekend", "ai hackathon", "fintech hackathon",
      "web3 hackathon", "blockchain hackathon", "codex hackathon",
    ],
  },
  {
    score: 64,
    reason: "Accelerator/incubator event — early-stage founders",
    keywords: [
      "accelerator", "incubator", "founder community", "startup showcase",
      "startup program", "cohort", "scale-up", "scaleup",
      "b2b saas founders", "saas founders",
      "founder retreat", "cto summit", "ceo summit",
      "founder community", "founders community", "founder circle",
      "founder network", "founders network", "founder collective",
      "founder hub", "founders hub", "founder lab", "founders lab",
      "founder house", "founders house",
    ],
  },
  {
    score: 62,
    reason: "Deep tech / PhD founder event — extraordinary ability O-1A profiles",
    keywords: [
      "deep tech", "deeptech", "phd founder", "scientist founder",
      "research startup", "research commercialisation",
      "physical ai", "frontier ai",
    ],
  },
  {
    score: 60,
    reason: "Tech conference with founder attendance",
    keywords: [
      "tech summit", "innovation summit",
      "tech conference", "startup conference",
      "innovation conference", "fintech summit", "climate tech summit",
      "healthtech summit", "proptech summit", "devops conference",
      "devopscon", "codemotion", "mlcon",
    ],
  },
];

// ---------------------------------------------------------------------------
// COLD (40-55): Still relevant — tech ecosystem, indirect path to founders
// ---------------------------------------------------------------------------
const COLD_CRITERIA: Array<{ score: number; reason: string; keywords: string[] }> = [
  {
    score: 55,
    reason: "Startup/founder networking — meaningful founder presence",
    keywords: [
      "startup networking", "founder networking", "tech networking",
      "entrepreneur networking", "founder meetup", "founders meetup",
      "startup meetup", "tech drinks", "founder speed networking",
      "startup mixer", "saas mixer", "tech mixer",
      "founder happy hour", "founders happy hour", "founder drinks",
      "founders drinks", "founder event", "founders event",
      "founder gathering", "founders gathering",
      "founder night", "founders night",
      "startup social", "startup drinks", "startup happy hour",
      "founder connect", "founders connect",
    ],
  },
  {
    score: 52,
    reason: "Tech meetup with potential founders",
    keywords: [
      "tech meetup", "developer meetup", "engineer meetup",
      "tech talk", "cursor meetup", "claude code",
    ],
  },
  {
    score: 50,
    reason: "Women in tech / diversity founder event — underserved O-1A market",
    keywords: [
      "women in tech", "women founders", "female founders", "women leaders",
      "sheconnects", "sheleads", "women applying ai",
      "women at the frontier", "lean in",
    ],
  },
  {
    score: 48,
    reason: "Tech workshop — builders upskilling, potential founders",
    keywords: [
      "tech workshop", "coding workshop", "ai workshop",
      "product workshop", "masterclass",
    ],
  },
  {
    score: 46,
    reason: "Panel / fireside chat with founders",
    keywords: [
      "fireside chat", "founder fireside", "tech panel",
      "leadership talk", "founder talk", "founders social",
      "capital session", "term sheet",
    ],
  },
  {
    score: 44,
    reason: "GTM / operator event — founders and operators",
    keywords: [
      "gtm breakfast", "gtm dinner", "go-to-market",
      "operator event", "operator dinner",
    ],
  },
  {
    score: 42,
    reason: "Launch / showcase event — new companies launching",
    keywords: [
      "launch party", "product launch", "launch event",
      "beta launch",
    ],
  },
  {
    score: 40,
    reason: "Sector-specific tech event with founder crossover",
    keywords: [
      "fintech event", "healthtech event", "edtech event", "proptech event",
      "climate tech", "biotech event", "medtech", "legaltech",
      "insurtech", "regtech", "agritech", "foodtech",
      "cybersecurity event", "quantum computing",
    ],
  },
];

// ---------------------------------------------------------------------------
// High-leverage boost signals (applied on top of base score)
// ---------------------------------------------------------------------------
const LEVERAGE_BOOSTS: Array<{ bonus: number; reason: string; keywords: string[] }> = [
  {
    bonus: 12,
    reason: "International / European founder angle — core ICP",
    keywords: [
      "international founder", "european founder", "global founder",
      "non-us founder", "cross-border", "european startup",
      "french startup", "german startup", "british startup",
      "nordic startup", "uk startup", "eu startup",
    ],
  },
  {
    bonus: 8,
    reason: "AI / deep tech focus — extraordinary ability profile for O-1A",
    keywords: [
      "ai founder", "ai startup", "deep tech", "frontier ai",
      "machine learning startup", "research commercialisation",
      "phd founder", "scientist founder", "research startup",
      "agentic ai", "open source ai",
      "llm startup", "generative ai", "foundation model",
    ],
  },
  {
    bonus: 6,
    reason: "Judging / awards — O-1A judging criteria signal",
    keywords: [
      "judging panel", "jury", "judges", "judged by", "award ceremony",
      "startup award", "innovation award", "best startup",
      "startup of the year", "founder of the year",
    ],
  },
  {
    bonus: 5,
    reason: "Patent / innovation / original contribution signal",
    keywords: [
      "patent", "original contribution", "novel research",
      "breakthrough", "innovation award", "r&d",
    ],
  },
];

// ---------------------------------------------------------------------------
// Core scoring function
// ---------------------------------------------------------------------------
export function scoreLeadQuality(title: string, description: string): LeadScore {
  const text = `${title} ${description}`.toLowerCase();

  // ---- BLOCKLIST CHECK: instant kill ----
  if (BLOCKLIST_KEYWORDS.some((kw) => text.includes(kw))) {
    return { score: 0, tier: "cold", highLeverage: false, leverageReason: "" };
  }

  let topScore = 0;
  let topReason = "";

  // Check all criteria groups
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

  // Baseline: strong founder/startup signal only (no more broad "tech" baseline)
  if (topScore === 0) {
    const founderKeywords = [
      "founder", "founders", "startup", "startups", "start-up",
      "entrepreneur", "entrepreneurship", "saas", "fintech", "deeptech",
      "web3", "venture", "vc ", "investor", "pre-seed", "seed stage",
      "series a", "fundrais", "accelerat", "incubat",
    ];
    if (founderKeywords.some((kw) => text.includes(kw))) {
      topScore = 30;
      topReason = "General founder/startup event";
    }
  }

  // Secondary baseline: only if explicitly tech-focused (tighter than before)
  if (topScore === 0) {
    const strictTechKeywords = [
      "software engineer", "machine learning", "artificial intelligence",
      "data science", "cloud computing", "blockchain developer",
      "devops", "cybersecurity", "quantum computing", "robotics",
      "open source", "api developer", "platform engineer",
    ];
    if (strictTechKeywords.some((kw) => text.includes(kw))) {
      topScore = 20;
      topReason = "Technical community event";
    }
  }

  // NO MORE baseline tier 3 — if it doesn't match founder or strict tech, it scores 0

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
    "vivatech", "slush", "web summit", "wolves summit",
  ];
  const highLeverage =
    topScore >= 80 || highLeverageKeywords.some((kw) => text.includes(kw));

  const leverageReason = highLeverage ? topReason : "";

  return { score: topScore, tier, highLeverage, leverageReason };
}

// ---------------------------------------------------------------------------
// Event filtering — O-1A relevant events ONLY
// ---------------------------------------------------------------------------
export const EVENT_KEYWORDS = [
  // Core founder signals
  "hackathon", "buildathon", "demo day", "demo night",
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
  "climate tech", "healthtech", "proptech",
  "biotech", "medtech", "cybersecurity", "robotics", "quantum",
  // Tech (tighter)
  "software engineer", "developer meetup", "devops",
  "open source", "data science", "cloud computing",
  // Events types (founder-relevant only)
  "tech meetup", "fireside chat", "summit", "conference",
  "tech workshop", "ai workshop", "expo",
  // Expansion signals
  "us expansion", "us market", "relocation", "immigration",
  // Growth / GTM
  "scale-up", "scaleup", "gtm",
  // Major conferences
  "vivatech", "slush", "web summit", "collision", "techcrunch",
  "wolves summit", "latitude59", "tnw", "noah",
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
