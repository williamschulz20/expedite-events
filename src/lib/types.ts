export interface FounderEvent {
  id: string;
  title: string;
  description: string;
  date: string; // ISO string
  endDate?: string;
  location: string;
  url: string; // RSVP link
  source: "eventbrite" | "luma" | "partiful";
  category: string; // hackathon, demo-day, networking, pitch, etc.
  imageUrl?: string;
}

export const EVENT_KEYWORDS = [
  "hackathon",
  "demo day",
  "demo night",
  "pitch night",
  "pitch competition",
  "pitch event",
  "founder",
  "founders",
  "startup",
  "startups",
  "entrepreneur",
  "fundraising",
  "investor",
  "VC",
  "venture capital",
  "accelerator",
  "incubator",
  "techstars",
  "Y Combinator",
  "YC",
  "launch",
  "showcase",
  "networking",
  "tech meetup",
  "AI",
  "fintech",
  "SaaS",
  "seed",
  "series A",
  "immigration",
  "visa",
  "O-1",
  "startup visa",
];

export const CATEGORIES: Record<string, string[]> = {
  hackathon: ["hackathon", "hack", "buildathon"],
  "demo-day": ["demo day", "demo night", "showcase", "launch"],
  pitch: ["pitch night", "pitch competition", "pitch event"],
  networking: ["networking", "meetup", "social", "mixer", "drinks"],
  fundraising: ["fundraising", "investor", "VC", "venture capital", "seed", "series A"],
  accelerator: ["accelerator", "incubator", "techstars", "Y Combinator", "YC"],
  immigration: ["immigration", "visa", "O-1", "startup visa"],
  general: ["founder", "startup", "entrepreneur", "tech"],
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
