import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import fs from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "partiful-cache.json");

function loadCache(): FounderEvent[] {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveCache(events: FounderEvent[]) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(events, null, 2));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const incoming: Array<{ id: string; t: string; d?: string; u: string; c: string; ds?: string }> = body.events || [];

    const existing = loadCache();
    const seen = new Set(existing.map((e) => e.id));
    let added = 0;

    for (const raw of incoming) {
      const externalId = `partiful-${raw.id}`;
      if (seen.has(externalId)) continue;

      const title = raw.t || "";
      const desc = raw.ds || "";
      const sc = scoreLeadQuality(title, desc);

      existing.push({
        id: externalId,
        title,
        description: desc,
        date: raw.d || "",
        location: raw.c || "",
        url: raw.u || `https://partiful.com/e/${raw.id}`,
        source: "partiful",
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

export async function GET() {
  const events = loadCache();
  return NextResponse.json({ events, count: events.length, source: "partiful" });
}
