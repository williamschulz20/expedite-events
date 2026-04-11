import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import fs from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "luma-cache.json");

const CITIES = [
  "london", "berlin", "paris", "amsterdam", "munich", "barcelona", "lisbon",
  "stockholm", "helsinki", "dublin", "zurich", "copenhagen", "vienna", "madrid",
  "warsaw", "brussels", "geneva", "hamburg", "milan", "rome", "budapest", "prague",
  "new-york", "los-angeles", "austin", "boston", "tallinn", "oslo",
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

async function scrapeLumaCity(slug: string): Promise<Array<{ id: string; t: string; d: string; ed?: string; u: string; c: string; ds: string }>> {
  try {
    const res = await fetch(`https://lu.ma/${slug}?k=p`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return [];
    const nd = JSON.parse(m[1]);
    const d = nd.props?.pageProps?.initialData?.data;
    if (!d) return [];
    const city = d.page?.place?.name || slug;
    const evts = [...(d.events || []), ...(d.featured_events || [])];
    return evts
      .map((e: Record<string, unknown>) => {
        const ev = (e as { event?: Record<string, unknown> }).event || e;
        return {
          id: ev.api_id as string,
          t: ev.name as string,
          d: ev.start_at as string,
          ed: ev.end_at as string | undefined,
          u: (ev.url as string) || (ev.api_id as string),
          c: city,
          ds: ((ev.description_short as string) || "").slice(0, 300),
        };
      })
      .filter((e) => e.id);
  } catch {
    return [];
  }
}

export async function GET() {
  const existing = loadCache();
  const seen = new Set(existing.map((e) => e.id));
  let totalAdded = 0;
  const cityResults: Record<string, number> = {};

  // Process cities in batches of 3 with delays
  for (let i = 0; i < CITIES.length; i += 3) {
    const batch = CITIES.slice(i, i + 3);
    const results = await Promise.allSettled(batch.map(scrapeLumaCity));

    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status !== "fulfilled") { cityResults[batch[j]] = 0; continue; }
      let added = 0;
      for (const raw of r.value) {
        const externalId = `luma-${raw.id}`;
        if (seen.has(externalId)) continue;
        const title = raw.t || "";
        const desc = raw.ds || "";
        const sc = scoreLeadQuality(title, desc);
        const url = raw.u?.startsWith("http") ? raw.u : `https://lu.ma/${raw.u}`;
        existing.push({
          id: externalId,
          title,
          description: desc,
          date: raw.d || "",
          endDate: raw.ed || undefined,
          location: raw.c || "",
          url,
          source: "luma",
          category: categorizeEvent(title, desc),
          leadScore: sc.score,
          leadTier: sc.tier,
          highLeverage: sc.highLeverage,
          leverageReason: sc.leverageReason,
        });
        seen.add(externalId);
        added++;
      }
      cityResults[batch[j]] = added;
      totalAdded += added;
    }

    // Delay between batches to avoid rate limiting
    if (i + 3 < CITIES.length) await new Promise((r) => setTimeout(r, 2000));
  }

  saveCache(existing);

  return NextResponse.json({
    ok: true,
    added: totalAdded,
    total: existing.length,
    cities: cityResults,
    source: "luma-scrape",
    events: existing,
  });
}
