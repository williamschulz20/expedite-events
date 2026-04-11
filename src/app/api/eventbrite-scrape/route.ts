import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import fs from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "eventbrite-cache.json");

function loadCache(): FounderEvent[] {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveCache(events: FounderEvent[]) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(events, null, 2));
}

// POST: receive events scraped from Chrome browser
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const incoming: Array<{
      title: string;
      date: string;
      price: string;
      url: string;
      city: string;
    }> = body.events || [];

    const existing = loadCache();
    const seen = new Set(existing.map((e) => e.id));
    let added = 0;

    for (const raw of incoming) {
      const externalId = `eb-${raw.url.split("/e/")[1]?.split(/[?-]/)[0] || raw.title.slice(0, 40).replace(/\W/g, "-").toLowerCase()}`;
      if (seen.has(externalId)) continue;

      const title = raw.title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      const desc = "";
      const sc = scoreLeadQuality(title, desc);
      if (sc.score < 35) continue; // Only keep O-1A relevant events

      existing.push({
        id: externalId,
        title,
        description: desc,
        date: raw.date || "", // "Thu, Apr 23 • 5:00 PM" format from browser
        location: raw.city || "",
        url: raw.url,
        source: "eventbrite",
        category: categorizeEvent(title, desc),
        leadScore: sc.score,
        leadTier: sc.tier,
        highLeverage: sc.highLeverage,
        leverageReason: sc.leverageReason,
      });
      seen.add(externalId);
      added++;
    }

    saveCache(existing);
    return NextResponse.json({ ok: true, added, total: existing.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

// GET: return cached events
export async function GET() {
  const events = loadCache();
  return NextResponse.json({ events, count: events.length, source: "eventbrite-scrape" });
}
