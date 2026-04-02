# Expedite Events — Internal Technical Guide

**Last updated:** April 2026
**Built by:** William Schulz (Head of GTM)
**Stack:** Next.js 16 (App Router) · Supabase · Tailwind CSS · TypeScript

---

## What This Tool Does

Expedite Events is an internal event intelligence platform that scrapes, scores, and surfaces tech/startup events across Europe and the US where international founders gather. The goal: identify the highest-leverage events for the team to attend and book meetings with founders who fit Expedite's ICP.

The tool answers one question: **"Where are the founders who need us, and when?"**

---

## How to Use the Dashboard

### Views

| View | What it shows |
|------|--------------|
| **Calendar** | Month/week/day grid with color-coded event chips. Click any event to open details. |
| **List** | Scrollable event cards with full details, badges, and team attendance. |
| **Organizers** | Ranked organizer table — who hosts the most high-value events across cities. |

### Filters (Toolbar)

All filters stack — each narrows the results further.

| Filter | Options | Purpose |
|--------|---------|---------|
| **Search** | Free text | Find events by company name (e.g. "Anthropic", "Granola"), organizer, or keyword |
| **Tier** | All · Hot · Warm · Cold | Filter by lead quality score |
| **Category** | All · Hackathon · Demo Day · Pitch · Networking · Fundraising · Accelerator · Dinners & Breakfasts · Workshop | Event type |
| **Source** | All · Luma · Eventbrite · Partiful · Conferences · Other | Which platform the event was scraped from |
| **Price** | All · Free · Paid | Detected from event title/description (currency symbols, "free", "ticket price", etc.) |
| **City** | All · London · Berlin · Paris · etc. | Geographic filter — extracted from event location strings |
| **Best leads first** | Toggle (list view only) | Sort by lead score instead of date |

### Event Cards

Each event shows:
- **Tier badge** (🔥 Hot / 🟡 Warm / 🧊 Cold) with lead score
- **Free / Paid** badge (green / red)
- **Source** badge (which platform it came from)
- **Category** badge
- **High Leverage** badge (⚡) — events the team should prioritize
- **Team attendance dots** — who on the team is going (W, L, Q, L, T)
- **Organizer name** ("by Granola", "by Entrepreneur First")

### Team Attendance

- Click your profile icon (top right) to set your identity
- On any event, click "Going" to mark yourself as attending
- Team member colored circles appear on every event card, calendar chip, and in the detail modal
- If nobody is attending yet, dashed placeholder circles show the 5 team slots

### Accepting Events

- Click "Accept" on an event to add it to your calendar
- The event gets a "📅 In Calendar" badge
- Use the Google Calendar integration to sync accepted events

---

## Lead Scoring System

Every event gets a score from 0–100 based on keyword matching against its title and description. The score determines the tier and whether the event is flagged as "high leverage."

### Tiers

| Tier | Score Range | What It Means |
|------|------------|---------------|
| 🔥 **Hot** | 80–100 | Founders in decision mode RIGHT NOW. Demo days, pitch competitions, US expansion events, exclusive founder dinners. **The team should be in the room.** |
| 🟡 **Warm** | 55–79 | Strong founder signal. VC networking, AI summits, hackathons, accelerator community events, fundraising events. Worth attending if capacity allows. |
| 🧊 **Cold** | 0–54 | Broader tech ecosystem. General networking, workshops, panels, industry events. Founders are present but not the primary audience. |

### How Scoring Works (Technical)

The scoring engine in `src/lib/types.ts` works in 4 passes:

**Pass 1 — Criteria matching (highest score wins)**

The engine checks the event text against keyword lists in priority order. The first match with the highest score wins:

#### HOT Criteria (80+)

| Score | Trigger | Example Keywords |
|-------|---------|-----------------|
| 98 | Accelerator demo day | "demo day", "demo night", "batch demo", "yc demo", "techstars demo", "ef demo" |
| 92 | US expansion event | "us expansion", "us market", "silicon valley", "transatlantic", "us launch" |
| 90 | Top-tier accelerator | "y combinator", "techstars", "entrepreneur first", "antler", "a16z", "sequoia", "seedcamp" |
| 88 | Pitch competition | "pitch competition", "pitch battle", "pitch night", "startup competition" |
| 87 | Founder breakfast/dinner | "founder breakfast", "founder dinner", "ceo dinner", "invite-only dinner", "vc dinner" |
| 85 | Founder summit | "international founder", "founder summit", "founder conference" |

#### WARM — VC Tier (70–79)

| Score | Trigger | Example Keywords |
|-------|---------|-----------------|
| 78 | VC / investor networking | "vc networking", "venture capital", "angel investor", "seed stage", "fundraising event" |
| 75 | Portfolio founder event | "portfolio founders", "backed founders", "portfolio company" |
| 72 | Fundraising event | "fundraising", "lp/gp", "raise capital", "investor roundtable" |

#### WARM — Founder Adjacent (60–69)

| Score | Trigger | Example Keywords |
|-------|---------|-----------------|
| 68 | AI summit / ML conference | "ai summit", "ai conference", "llm summit", "neurips", "generative ai summit" |
| 66 | Hackathon / buildathon | "hackathon", "buildathon", "startup weekend", "ai hackathon" |
| 65 | Tech breakfast/dinner | "tech breakfast", "tech dinner", "startup dinner", "breakfast event" |
| 64 | Accelerator community | "accelerator", "incubator", "founder community", "startup showcase", "founder retreat" |
| 62 | Deep tech / PhD founder | "deep tech", "phd founder", "scientist founder", "research startup" |
| 60 | Tech summit | "tech summit", "web summit", "startup conference", "fintech summit" |

#### COLD (35–55)

| Score | Trigger | Example Keywords |
|-------|---------|-----------------|
| 55 | Startup networking | "startup networking", "founder meetup", "tech drinks" |
| 50 | Tech meetup | "tech meetup", "developer meetup", "tech talk" |
| 48 | Workshop / masterclass | "workshop", "bootcamp", "hands-on", "training session" |
| 46 | Panel / fireside | "panel discussion", "fireside chat", "roundtable" |
| 45 | GTM / growth event | "gtm breakfast", "go-to-market", "revenue ops", "operator dinner" |
| 43 | Launch event | "launch party", "product launch", "beta launch" |
| 40 | Innovation event | "innovation", "digital transformation", "future of work" |
| 38 | Tech community | "product hunt", "indie hacker", "open source", "coworking event" |
| 35 | Industry / sector | "fintech event", "healthtech event", "climate tech", "sustainability" |

**Pass 2 — Baseline fallback (if no criteria matched)**

If no specific criteria matched, the event gets a baseline score:

| Baseline | Score | Keywords (examples) |
|----------|-------|-------------------|
| Strong founder signal | 30 | "founder", "startup", "entrepreneur", "saas", "fintech", "venture", "investor" |
| Tech/innovation signal | 20 | "tech", "software", "ai", "machine learning", "blockchain", "cloud", "python", "react" |
| General event signal | 12 | "meetup", "networking", "conference", "summit", "workshop", "drinks", "mixer" |

**Pass 3 — Leverage boosts (additive, caps at 100)**

On top of the base score, bonus points are added for:

| Bonus | Signal | Keywords |
|-------|--------|----------|
| +10 | International/European founder angle | "international founder", "european founder", "cross-border", "french startup" |
| +8 | AI / deep tech focus | "ai founder", "deep tech", "frontier ai", "phd founder", "foundation model" |
| +5 | High-profile judges | "judging panel", "judges", "startup award", "innovation award" |

**Pass 4 — High leverage flag**

An event is flagged as "high leverage" (⚡) if:
- Its score is 80+ (any Hot event), OR
- It matches explicit high-leverage keywords like "demo day", "pitch competition", "us expansion", "founder breakfast", "investor dinner", "invite-only", etc.

---

## Event Categories

Events are categorized by keyword matching (first match wins, checked in order):

| Category | Keywords |
|----------|----------|
| Hackathon | hackathon, hack, buildathon |
| Demo Day | demo day, demo night, showcase |
| Pitch | pitch night, pitch competition, pitch event, pitch battle |
| Dinners & Breakfasts | dinner, breakfast, brunch, founder dinner, ceo breakfast, etc. |
| Networking | networking, meetup, social, mixer, drinks, summit |
| Fundraising | fundraising, investor, VC, venture capital, seed, angel |
| Accelerator | accelerator, incubator, techstars, Y Combinator, antler, seedcamp |
| Workshop | workshop, masterclass, bootcamp, hands-on, training |
| General | founder, startup, entrepreneur, tech (fallback) |

---

## Data Sources (14 Scrapers)

All scrapers run via API routes under `/src/app/api/`. They fire on page load and results are upserted into Supabase (`scraped_events` table) with deduplication on `external_id`.

### Primary Sources

| # | Source | Route | Coverage | How It Works |
|---|--------|-------|----------|-------------|
| 1 | **Luma** | `/api/luma` | 35 cities + 65+ community slugs | Scrapes Luma's `__NEXT_DATA__`, `place/get-items` API, and `calendar/get-items` API. Paginates through city explore pages and individual community/organizer calendars. |
| 2 | **Eventbrite** | `/api/eventbrite` | 16 cities × 24 search queries | Scrapes Eventbrite search result HTML. Iterates city slugs × keyword queries (incl. "founder dinner", "CEO breakfast", "deep tech"). |
| 3 | **Partiful** | `/api/partiful` | Social/founder events | Scrapes Partiful event pages for invite-only and social founder events. |

### Conference Sources

| # | Source | Route | Coverage | How It Works |
|---|--------|-------|----------|-------------|
| 4 | **Conferences** | `/api/conferences` | 25 curated major conferences | Hardcoded list of marquee events (Latitude59, Slush, Web Summit, London Tech Week, etc.) with known dates. Scrapes official sites for JSON-LD updates. |
| 5 | **confs.tech** | `/api/confstech` | 8 tech topics globally | Fetches structured JSON from the confs.tech GitHub repo. Topics: javascript, python, devops, general, ai-ml, cloud, data, security. |
| 6 | **developers.events** | `/api/devevents` | Global dev conferences | Free JSON API at `developers.events/all-events.json`. Filters to 2026 events in target countries/cities. |

### Search-Based Discovery

| # | Source | Route | Coverage | How It Works |
|---|--------|-------|----------|-------------|
| 7 | **Google Search** | `/api/googlesearch` | 33 cities × 11 keywords × 6 months | Scrapes Google search results for event URLs. Samples 3 random cities per keyword-month combo. Extracts JSON-LD and OG metadata from found pages. |
| 8 | **DuckDuckGo Search** | `/api/websearch` | 19 cities × 14 keywords | HTML scraping of DuckDuckGo results for cities not well-covered by Luma/Eventbrite. 12-month lookback. |

### Platform Scrapers

| # | Source | Route | Coverage | How It Works |
|---|--------|-------|----------|-------------|
| 9 | **F6S** | `/api/f6s` | 16 cities | Scrapes F6S event search pages. Three parsing strategies: JSON-LD, `/event/<slug>` links, HTML card patterns. |
| 10 | **GarysGuide** | `/api/garysguide` | SF, NYC, LA, Boston, Austin, London | Scrapes GarysGuide event listings by region. JSON-LD first, then regex fallback for event cards. |
| 11 | **10times** | `/api/tentimes` | 18 cities × technology + startups | Scrapes 10times.com event pages. Two categories per city (technology, startups = 36 pages). |
| 12 | **Startup Grind** | `/api/startupgrind` | 18 city chapters + global | Scrapes main events page + chapter pages. Parses JSON-LD (including `@graph` arrays) and event card HTML. |

### Niche Sources

| # | Source | Route | Coverage | How It Works |
|---|--------|-------|----------|-------------|
| 13 | **SelectUSA** | `/api/selectusa` | Investment Summit + roadshows | Hardcoded SelectUSA events (summit, European/Asia/LatAm roadshows). All scored 80+ since attendees are inherently high-value. |
| 14 | **University** | `/api/university` | 14 top universities | DDG searches for startup/hackathon/entrepreneur events at Imperial, UCL, LBS, MIT, Stanford, ETH Zurich, etc. |

### Cities Covered

**Western Europe:** London, Amsterdam, Berlin, Paris, Munich, Zurich, Stockholm, Barcelona, Lisbon, Dublin, Helsinki, Copenhagen, Milan, Madrid, Vienna, Warsaw, Brussels, Budapest, Prague, Rome, Hamburg, Geneva, Lausanne, Istanbul

**Nordics & Baltics:** Tallinn, Riga, Vilnius, Oslo

**Central & Eastern Europe:** Bucharest, Sofia, Belgrade, Zagreb, Krakow

**North America:** San Francisco, New York, Los Angeles, Austin, Boston

---

## Pricing Detection

Events are tagged as **Free** or **Paid** based on signals in the title and description:

| Tag | Signals |
|-----|---------|
| **Free** (green) | "free", "no cost", "complimentary", "free entry", "free event", "free admission", "free ticket", "no charge", "gratis" |
| **Paid** (red) | "£", "$", "€", "paid", "ticket price", "buy ticket", "purchase ticket", "registration fee", "early bird" |

If neither signal is detected, no badge is shown.

---

## Organizer Rankings

The Organizers view (`/api/organizers`) aggregates all events by organizer name and ranks them by:

1. Number of Hot events hosted
2. Total events hosted
3. City presence

Each organizer shows:
- **Person vs Organisation** — heuristic detection based on name signals ("capital", "ventures", "ai", "&", etc.)
- **City** — extracted from their events' location data
- **Event counts** — split by tier (🔥 Hot / 🟡 Warm / 🧊 Cold)
- **Contact link** — Luma profile URL (prioritizes `lu.ma/u/<userId>` for reliability)

---

## Database (Supabase)

### Tables

| Table | Purpose |
|-------|---------|
| `scraped_events` | All events, upserted on `external_id`. Columns: title, description, date, location, url, source, category, lead_score, lead_tier, organizer_name, etc. |
| `organizers` | Organizer profiles extracted from Luma. |
| `team_members` | The 5 Expedite team members (W, L, Q, L, T). |
| `event_attendance` | Who on the team is attending which event. |

### Upsert Logic

All scrapers feed through a common upsert pipeline:
1. Scraper returns array of `FounderEvent` objects
2. Each event gets scored via `scoreLeadQuality(title, description)`
3. Events are upserted into `scraped_events` with `external_id` as the conflict key
4. Duplicates are merged — newer data overwrites older data

---

## Cron / Automation

- **Daily scrape cron:** `/api/cron` runs daily at 8am UTC (configured in `vercel.json`)
- **GitHub auto-commits:** Cron job creates 6 commits/day (9am–3pm) to maintain contribution history
- **Background scrape on page load:** All scrapers fire in parallel when the dashboard loads

---

## File Structure

```
src/
├── app/
│   ├── page.tsx              # Main dashboard UI (~2500 lines)
│   └── api/
│       ├── events/route.ts   # Aggregator — calls all scrapers, returns combined results
│       ├── luma/route.ts     # Luma scraper (35 cities + 65 communities)
│       ├── eventbrite/route.ts
│       ├── partiful/route.ts
│       ├── conferences/route.ts
│       ├── confstech/route.ts
│       ├── devevents/route.ts
│       ├── googlesearch/route.ts
│       ├── websearch/route.ts
│       ├── f6s/route.ts
│       ├── garysguide/route.ts
│       ├── tentimes/route.ts
│       ├── startupgrind/route.ts
│       ├── selectusa/route.ts
│       ├── university/route.ts
│       ├── meetup/route.ts
│       ├── organizers/route.ts
│       ├── team/route.ts
│       ├── attendance/route.ts
│       ├── accept/route.ts
│       ├── attend/route.ts
│       ├── calendar/route.ts
│       ├── rsvp/route.ts
│       ├── cron/route.ts
│       └── debug/route.ts
└── lib/
    └── types.ts              # Scoring engine, categories, event keywords
```

---

## For Engineers: How to Add a New Scraper

1. Create `/src/app/api/<name>/route.ts`
2. Export `async function GET()` that returns `NextResponse.json({ events, count, source })`
3. Map results to the `FounderEvent` interface from `@/lib/types`
4. Use `categorizeEvent(title, description)` for category assignment
5. Use `scoreLeadQuality(title, description)` for lead scoring (or let the aggregator do it)
6. Use unique `id` prefix (e.g. `"mysource-<hash>"`) to avoid collisions
7. Set `source` to a unique string matching your scraper name
8. Add your source to the `FounderEvent.source` union type in `src/lib/types.ts`
9. Wire it into the aggregator at `/api/events/route.ts`
10. If needed, add the source to `SOURCE_STYLES` and `SOURCE_TABS` in `page.tsx`

### Scraper Patterns

All scrapers follow the same pattern:
- **Realistic User-Agent** to avoid bot detection
- **AbortSignal.timeout** on all fetches (10–15 seconds)
- **Batched requests** (3–5 concurrent) with delays between batches
- **Graceful error handling** — failed cities/queries don't crash the whole scraper
- **Deduplication** by URL or computed hash
- **JSON-LD first, HTML regex fallback** for parsing event data

---

## Key Design Decisions

1. **Why keyword-based scoring instead of ML?** Speed, transparency, and debuggability. The team can read `types.ts` and understand exactly why an event scored 87. Easy to tune by adding/removing keywords.

2. **Why `source: "luma"` was originally used everywhere?** Quick hack to get all events rendering through the existing pipeline. Now fixed — each scraper uses its real source name.

3. **Why 3-tier baseline scoring?** Without baselines, only ~97 events passed the filter (score > 0). The 3-tier baseline (30/20/12) ensures events from our scraped sources always get a minimum score, while still ranking them meaningfully.

4. **Why organizer org detection is heuristic?** Supabase MCP was failing, so we couldn't add an `organizer_org` column. Instead, we detect person vs. organization by checking name patterns (contains "capital", "ventures", "&", etc.).

5. **Why pricing detection uses keywords?** Most event APIs don't expose pricing data. Text-based detection catches ~60-70% of cases. Unknown pricing shows no badge (rather than guessing wrong).
