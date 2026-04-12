import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city");

  try {
    // Compute organizer rankings live from scraped_events
    // This works even if the organizers table hasn't been populated yet
    const { data: eventRows, error } = await supabase
      .from("scraped_events")
      .select("organizer_luma_id, organizer_name, organizer_username, organizer_linkedin, location, lead_tier, url, starts_at, title")
      .not("organizer_name", "is", null)
      .gte("starts_at", new Date().toISOString());

    if (error) throw error;

    // Also fetch any extra data stored in organizers table (avatar, website, bio, email)
    const { data: orgRows } = await supabase
      .from("organizers")
      .select("luma_user_id, avatar_url, website, email, bio, twitter_handle");

    const orgMeta = new Map<string, Record<string, unknown>>();
    for (const row of orgRows ?? []) {
      if (row.luma_user_id) orgMeta.set(row.luma_user_id, row);
    }

    // City matching helper
    const CITY_MAP: [string, string][] = [
      ["london", "London"], ["berlin", "Berlin"], ["paris", "Paris"],
      ["amsterdam", "Amsterdam"], ["san francisco", "San Francisco"],
      ["munich", "Munich"], ["barcelona", "Barcelona"], ["stockholm", "Stockholm"],
      ["zurich", "Zurich"], ["dublin", "Dublin"], ["lisbon", "Lisbon"],
      ["istanbul", "Istanbul"], ["warsaw", "Warsaw"], ["budapest", "Budapest"],
      ["milan", "Milan"], ["copenhagen", "Copenhagen"], ["helsinki", "Helsinki"],
      ["vienna", "Vienna"], ["brussels", "Brussels"], ["hamburg", "Hamburg"],
      ["geneva", "Geneva"], ["lausanne", "Lausanne"], ["prague", "Prague"],
      ["rome", "Rome"], ["madrid", "Madrid"], ["new york", "New York"],
      ["los angeles", "Los Angeles"], ["boston", "Boston"],
      ["tallinn", "Tallinn"], ["riga", "Riga"], ["vilnius", "Vilnius"],
      ["oslo", "Oslo"], ["bucharest", "Bucharest"], ["sofia", "Sofia"],
      ["belgrade", "Belgrade"], ["zagreb", "Zagreb"], ["krakow", "Krakow"],
      ["austin", "Austin"],
    ];

    function extractCity(location: string): string | null {
      const loc = (location ?? "").toLowerCase();
      if (!loc) return null;
      for (const [match, name] of CITY_MAP) {
        if (loc.includes(match)) return name;
      }
      return null;
    }

    // Group by organizer
    type OrgData = {
      luma_user_id: string | null;
      name: string;
      username: string | null;
      linkedin_handle: string | null;
      primary_city: string | null;
      avatar_url: string | null;
      website: string | null;
      email: string | null;
      twitter_handle: string | null;
      total_events: number;
      hot_events: number;
      warm_events: number;
      cold_events: number;
      events: Array<{ title: string; url: string; starts_at: string; tier: string }>;
    };

    const map = new Map<string, OrgData>();

    for (const row of eventRows ?? []) {
      const key = row.organizer_luma_id ?? row.organizer_name ?? "";
      if (!key) continue;

      // Apply city filter
      if (city) {
        const loc = (row.location ?? "").toLowerCase();
        if (!loc.includes(city.toLowerCase())) continue;
      }

      if (!map.has(key)) {
        const meta = row.organizer_luma_id ? orgMeta.get(row.organizer_luma_id) : null;

        map.set(key, {
          luma_user_id: row.organizer_luma_id ?? null,
          name: row.organizer_name ?? "",
          username: row.organizer_username ?? null,
          linkedin_handle: row.organizer_linkedin ?? null,
          primary_city: extractCity(row.location ?? ""),
          avatar_url: (meta?.avatar_url as string) ?? null,
          website: (meta?.website as string) ?? null,
          email: (meta?.email as string) ?? null,
          twitter_handle: (meta?.twitter_handle as string) ?? null,
          total_events: 0,
          hot_events: 0,
          warm_events: 0,
          cold_events: 0,
          events: [],
        });
      }

      const org = map.get(key)!;

      // Update city if we don't have one yet (use any event's location)
      if (!org.primary_city) {
        org.primary_city = extractCity(row.location ?? "");
      }

      org.total_events++;
      if (row.lead_tier === "hot")  org.hot_events++;
      else if (row.lead_tier === "warm") org.warm_events++;
      else org.cold_events++;

      if (org.events.length < 5) {
        org.events.push({
          title: row.title ?? "",
          url: row.url ?? "",
          starts_at: row.starts_at ?? "",
          tier: row.lead_tier ?? "cold",
        });
      }
    }

    // Heuristic: if name has no space or contains org-like words, it's an org/community
    const ORG_SIGNALS = ["capital", "ventures", "vc", "fund", "labs", "network", "community",
      "founders", "club", "hub", "house", "station", "incubator", "accelerator",
      "ai", "tech", "digital", "&", "collective", "summit", "institute"];
    function isOrgName(name: string): boolean {
      if (!name.includes(" ")) return true; // single word = org/handle
      const lower = name.toLowerCase();
      return ORG_SIGNALS.some((s) => lower.includes(s));
    }

    const organizers = Array.from(map.values())
      .filter((o) => o.name)
      .sort((a, b) => b.hot_events - a.hot_events || b.warm_events - a.warm_events || b.total_events - a.total_events)
      .map((o) => {
        // Derive org_name: if the name itself is org-like, show it as org; otherwise "—"
        const orgName = isOrgName(o.name) ? o.name : null;

        return {
          ...o,
          org_name: orgName,
          luma_profile_url: o.luma_user_id
            ? `https://lu.ma/u/${o.luma_user_id}`
            : o.username
            ? `https://lu.ma/${o.username}`
            : null,
          linkedin_url: o.linkedin_handle
            ? o.linkedin_handle.startsWith("http")
              ? o.linkedin_handle
              : `https://linkedin.com${o.linkedin_handle.startsWith("/") ? "" : "/in/"}${o.linkedin_handle}`
            : null,
          twitter_url: o.twitter_handle
            ? `https://twitter.com/${o.twitter_handle.replace("@", "")}`
            : null,
        };
      });

    return NextResponse.json({ organizers, total: organizers.length });
  } catch (err) {
    console.error("Organizers route error:", err);
    return NextResponse.json({ organizers: [], total: 0 }, { status: 500 });
  }
}
