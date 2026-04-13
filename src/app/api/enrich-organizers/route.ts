import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// /api/enrich-organizers
// Walks scraped_events rows missing organiser data, fetches the event's
// public HTML page (Luma, Partiful, Eventbrite), parses out:
//   - organiser name
//   - LinkedIn URL / handle
//   - email (if exposed)
//   - website
//   - Twitter handle
// Writes results back to scraped_events + upserts into organizers table.
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface OrganiserInfo {
  name?: string;
  linkedin?: string;
  email?: string;
  website?: string;
  twitter?: string;
  luma_user_id?: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
}

// Generic helpers --------------------------------------------------------
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company|school)\/[A-Za-z0-9\-_%]+\/?/gi;
const TWITTER_RE = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})(?:\/|$|\?)/i;

function firstMatch(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m ? m[0] : undefined;
}

function pickEmail(html: string): string | undefined {
  const matches = html.match(EMAIL_RE) ?? [];
  const good = matches.find(
    (e) =>
      !e.endsWith(".png") &&
      !e.endsWith(".jpg") &&
      !e.includes("sentry") &&
      !e.includes("example.com") &&
      !e.includes("wixpress") &&
      !e.includes("no-reply") &&
      !e.includes("noreply"),
  );
  return good;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseLuma(html: string): OrganiserInfo | null {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    const nd = JSON.parse(m[1]);
    const data = nd.props?.pageProps?.initialData?.data ?? nd.props?.pageProps?.data ?? nd.props?.pageProps ?? {};
    const hosts: Array<Record<string, unknown>> = (data.hosts as Array<Record<string, unknown>>) ?? (data.event?.hosts as Array<Record<string, unknown>>) ?? (data.calendar?.hosts as Array<Record<string, unknown>>) ?? [];
    const primary = hosts[0];
    if (!primary) return null;
    const info: OrganiserInfo = {
      name: (primary.name as string) || undefined,
      username: (primary.username as string) || undefined,
      luma_user_id: (primary.api_id as string) || (primary.user_api_id as string) || undefined,
      avatar_url: (primary.avatar_url as string) || undefined,
      bio: (primary.bio_short as string) || (primary.bio as string) || undefined,
      website: (primary.website as string) || undefined,
      linkedin: (primary.linkedin_handle as string) || (primary.linkedin_url as string) || undefined,
      twitter: (primary.twitter_handle as string) || undefined,
      email: (primary.email as string) || undefined,
    };
    if (!info.linkedin) info.linkedin = firstMatch(m[1], LINKEDIN_RE);
    if (!info.email) info.email = pickEmail(m[1]);
    return info;
  } catch { return null; }
}

function parseEventbrite(html: string): OrganiserInfo | null {
  const info: OrganiserInfo = {};
  const ldMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      const ld = JSON.parse(m[1]);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        const organizer = item.organizer;
        if (organizer) {
          const o = Array.isArray(organizer) ? organizer[0] : organizer;
          info.name = info.name || o.name;
          info.website = info.website || o.url;
          info.email = info.email || o.email;
        }
      }
    } catch { /* skip */ }
  }
  if (!info.name) {
    const nameMeta = html.match(/<meta[^>]*name="author"[^>]*content="([^"]+)"/i);
    if (nameMeta) info.name = nameMeta[1];
  }
  info.linkedin = info.linkedin || firstMatch(html, LINKEDIN_RE);
  info.email = info.email || pickEmail(html);
  const twMatch = html.match(TWITTER_RE);
  if (twMatch) info.twitter = twMatch[1];
  return info.name || info.linkedin || info.email ? info : null;
}

function parsePartiful(html: string): OrganiserInfo | null {
  const info: OrganiserInfo = {};
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (m) {
    try {
      const nd = JSON.parse(m[1]);
      const host = nd.props?.pageProps?.event?.host ?? nd.props?.pageProps?.host ?? nd.props?.pageProps?.event?.createdBy ?? null;
      if (host) {
        info.name = host.displayName || host.name || host.username;
        info.avatar_url = host.photoURL || host.avatarUrl;
        info.username = host.username;
      }
    } catch { /* skip */ }
  }
  if (!info.name) {
    const og = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+?)(?:\s+(?:by|hosted by)\s+([^"]+))?"/i);
    if (og) info.name = og[2] || undefined;
  }
  info.linkedin = info.linkedin || firstMatch(html, LINKEDIN_RE);
  info.email = info.email || pickEmail(html);
  const twMatch = html.match(TWITTER_RE);
  if (twMatch) info.twitter = twMatch[1];
  return info.name || info.linkedin || info.email ? info : null;
}

function platformFromUrl(url: string): "luma" | "eventbrite" | "partiful" | "other" {
  const u = url.toLowerCase();
  if (u.includes("lu.ma")) return "luma";
  if (u.includes("eventbrite.")) return "eventbrite";
  if (u.includes("partiful.")) return "partiful";
  return "other";
}

async function enrichOne(url: string): Promise<OrganiserInfo | null> {
  const html = await fetchHtml(url);
  if (!html) return null;
  const platform = platformFromUrl(url);
  if (platform === "luma") return parseLuma(html);
  if (platform === "eventbrite") return parseEventbrite(html);
  if (platform === "partiful") return parsePartiful(html);
  return null;
}

function normaliseLinkedin(v?: string): string | undefined {
  if (!v) return undefined;
  if (v.startsWith("http")) return v;
  const handle = v.replace(/^\/?(in\/)?/, "");
  return `https://linkedin.com/in/${handle}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const force = searchParams.get("force") === "true";
  let query = supabase.from("scraped_events").select("id, url, organizer_name, organizer_linkedin, organizer_luma_id").not("url", "is", null).gte("starts_at", new Date().toISOString()).limit(limit);
  if (!force) query = query.or("organizer_name.is.null,organizer_linkedin.is.null");
  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let updated = 0, skipped = 0;
  const failures: Array<{ id: string; url: string }> = [];
  for (const row of rows ?? []) {
    const info = await enrichOne(row.url);
    if (!info || (!info.name && !info.linkedin && !info.email)) { skipped++; failures.push({ id: row.id, url: row.url }); await new Promise((r) => setTimeout(r, 500)); continue; }
    const linkedinFull = normaliseLinkedin(info.linkedin);
    await supabase.from("scraped_events").update({ organizer_name: info.name ?? row.organizer_name, organizer_username: info.username, organizer_linkedin: linkedinFull ?? row.organizer_linkedin, organizer_luma_id: info.luma_user_id ?? row.organizer_luma_id }).eq("id", row.id);
    if (info.luma_user_id || info.name) {
      await supabase.from("organizers").upsert({ luma_user_id: info.luma_user_id ?? null, name: info.name ?? null, avatar_url: info.avatar_url ?? null, website: info.website ?? null, email: info.email ?? null, bio: info.bio ?? null, linkedin_url: linkedinFull ?? null, twitter_handle: info.twitter ?? null }, { onConflict: info.luma_user_id ? "luma_user_id" : "name" });
    }
    updated++; await new Promise((r) => setTimeout(r, 500));
  }
  return NextResponse.json({ ok: true, scanned: rows?.length ?? 0, updated, skipped, failures: failures.slice(0, 10) });
}
