import { NextResponse } from "next/server";
import { FounderEvent, categorizeEvent, scoreLeadQuality } from "@/lib/types";
import fs from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "luma-cache.json");

function loadCache(): FounderEvent[] {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

function saveCache(events: FounderEvent[]) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(events, null, 2));
}

// POST: receive scraped events from browser
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const incoming: Array<{
      id: string;
      t: string;
      d: string;
      ed?: string;
      u: string;
      c: string;
      ds?: string;
    }> = body.events || [];

    const existing = loadCache();
    const seen = new Set(existing.map((e) => e.id));

    let added = 0;
    for (const raw of incoming) {
      const externalId = `luma-${raw.id}`;
      if (seen.has(externalId)) continue;

      const title = raw.t || "";
      const desc = raw.ds || "";
      const score = scoreLeadQuality(title, desc);
      const url = raw.u?.startsWith("http") ? raw.u : `https://lu.ma/${raw.u}`;

      const evt: FounderEvent = {
        id: externalId,
        title,
        description: desc,
        date: raw.d || "",
        endDate: raw.ed || undefined,
        location: raw.c || "",
        url,
        source: "luma",
        category: categorizeEvent(title, desc),
        leadScore: score.score,
        leadTier: score.tier,
        highLeverage: score.highLeverage,
        leverageReason: score.leverageReason,
      };

      existing.push(evt);
      seen.add(externalId);
      added++;
    }

    saveCache(existing);

    return NextResponse.json({ ok: true, added, total: existing.length });
  } catch (error) {
    console.error("luma-import POST error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

// GET: return all cached luma events
export async function GET() {
  const events = loadCache();
  return NextResponse.json({ events, count: events.length, source: "luma" });
}
