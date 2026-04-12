import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import fs from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "partiful-cache.json");

const CITIES: Array<{ slug: string; label: string }> = [
  { slug: "lon", label: "London" },
  { slug: "nyc", label: "New York" },
  { slug: "sf", label: "San Francisco" },
  { slug: "la", label: "Los Angeles" },
  { slug: "bos", label: "Boston" },
  { slug: "atx", label: "Austin" },
  { slug: "chi", label: "Chicago" },
  { slug: "mia", label: "Miami" },
  { slug: "dc", label: "Washington DC" },
];

function loadCache(): FounderEvent[] {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveCache(events: FounderEvent[]) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(events, null, 2));
}

async function scrapePartifulCity(slug: string, cityLabel: string): Promise<FounderEvent[]> {
  try {
    const url = `https://partiful.com/explore/${slug}`;
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const events: FounderEvent[] = [];

    // Extract event links: /e/{id}
    const linkMatches = html.matchAll(/href="\/e\/([a-zA-Z0-9_-]+)(?:\?[^"]*)?"/g);
    const eventIds = new Set<string>();
    for (const m of linkMatches) {
      eventIds.add(m[1]);
    }

    // Extract event titles from headings near event links
    // Pattern: event card contains link + heading + date + location
    // Try to extract titles from the HTML structure
    const titlePattern = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/g;
    const titles: string[] = [];
    for (const m of html.matchAll(titlePattern)) {
      const t = m[1].trim();
      if (t.length > 2 && t.length < 200) titles.push(t);
    }

    // Try __NEXT_DATA__ first (React SSR)
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const props = data?.props?.pageProps || {};
        const items = props.events || props.initialEvents || props.discoverEvents || [];
        for (const item of items) {
          const ev = item.event || item;
          const id = ev.id || ev.uuid || ev.slug || "";
          if (!id) continue;

          const title = ev.name || ev.title || "";
          const desc = (ev.description || "").slice(0, 300);
          const sc = scoreLeadQuality(title, desc);

          events.push({
            id: `partiful-${id}`,
            title,
            description: desc,
            date: ev.start_date || ev.startDate || ev.date || "",
            endDate: ev.end_date || ev.endDate || undefined,
            location: cityLabel,
            url: `https://partiful.com/e/${id}`,
            source: "partiful",
            category: categorizeEvent(title, desc),
            imageUrl: ev.image_url || ev.imageUrl || ev.cover || undefined,
            leadScore: sc.score,
            leadTier: sc.tier,
            highLeverage: sc.highLeverage,
            leverageReason: sc.leverageReason,
          });
        }
      } catch {}
    }

    // If __NEXT_DATA__ didn't yield events, use the link IDs + titles
    if (events.length === 0) {
      const idArr = Array.from(eventIds);
      // Match IDs with titles (they appear in order)
      const skipTitles = new Set(["san francisco", "boston", "washington, d.c.", "chicago", "miami", "austin", "new york city", "los angeles", "london"]);
      const validTitles = titles.filter(t => !skipTitles.has(t.toLowerCase()));

      for (let i = 0; i < idArr.length; i++) {
        const id = idArr[i];
        const title = validTitles[i] || `Event ${id.slice(0, 8)}`;
        const desc = "";
        const sc = scoreLeadQuality(title, desc);

        events.push({
          id: `partiful-${id}`,
          title,
          description: desc,
          date: "",
          location: cityLabel,
          url: `https://partiful.com/e/${id}`,
          source: "partiful",
          category: categorizeEvent(title, desc),
          leadScore: sc.score,
          leadTier: sc.tier,
          highLeverage: sc.highLeverage,
          leverageReason: sc.leverageReason,
        });
      }
    }

    return events;
  } catch {
    return [];
  }
}

export async function GET() {
  const existing = loadCache();
  const seen = new Set(existing.map(e => e.id));
  let totalAdded = 0;
  const cityResults: Record<string, number> = {};

  // Process cities in batches of 3
  for (let i = 0; i < CITIES.length; i += 3) {
    const batch = CITIES.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map(c => scrapePartifulCity(c.slug, c.label))
    );

    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status !== "fulfilled") { cityResults[batch[j].label] = 0; continue; }

      let added = 0;
      for (const ev of r.value) {
        if (!seen.has(ev.id)) {
          existing.push(ev);
          seen.add(ev.id);
          added++;
        }
      }
      cityResults[batch[j].label] = added;
      totalAdded += added;
    }

    if (i + 3 < CITIES.length) await new Promise(r => setTimeout(r, 1500));
  }

  saveCache(existing);
  return NextResponse.json({
    ok: true,
    added: totalAdded,
    total: existing.length,
    cities: cityResults,
    source: "partiful-scrape",
    events: existing,
  });
}
