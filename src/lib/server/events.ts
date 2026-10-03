import { applyContext, dedupeEvents, withHygiene, type RadarEvent } from "@/lib/radar";
import { loadGrades } from "@/lib/server/feedback";

// Shared by /api/events and /api/feed so the app and the GTM calendar see the
// same cleaned, re-scored events.

function remapSource(externalId: string, dbSource: string): string {
  if (dbSource !== "luma") return dbSource;
  if (externalId.startsWith("eb-")) return "eventbrite";
  if (externalId.startsWith("conf-")) return "confstech";
  if (externalId.startsWith("devev-")) return "devevents";
  if (externalId.startsWith("f6s-")) return "f6s";
  if (externalId.startsWith("gg-")) return "garysguide";
  if (externalId.startsWith("gsearch-")) return "googlesearch";
  if (externalId.startsWith("web-")) return "websearch";
  if (externalId.startsWith("10t-")) return "tentimes";
  if (externalId.startsWith("sg-")) return "startupgrind";
  if (externalId.startsWith("selectusa-")) return "selectusa";
  if (externalId.startsWith("uni-")) return "university";
  if (externalId.startsWith("partiful-")) return "partiful";
  if (externalId.startsWith("meetup-")) return "meetup";
  const confIds = ["latitude59", "slush", "web-summit", "tnw", "noah", "viva", "collision", "techcrunch", "rise-conf", "wolves", "arctic15", "login-", "riga-comm", "oslo-innovation", "sifted", "london-tech-week", "bits-pretzels", "pirate-summit", "pioneers", "south-summit", "websummit", "startup-grind", "tech-open-air", "tallinn-digital"];
  if (confIds.some((c) => externalId.startsWith(c))) return "conference";
  return "luma";
}

/**
 * Stored rows to what the app shows: hygiene flags, re-scored with the
 * cross-listing rules and the team's grades, one row per real event, and the
 * team's grade on anything already graded.
 */
export async function prepareRows(rows: Record<string, unknown>[], opts: { past: boolean; includeStale: boolean }) {
  const { feedback, byEvent } = await loadGrades();
  const now = Date.now();
  const scored = applyContext(rows.map((r) => withHygiene(rowToEvent(r), now)), feedback);
  const events = dedupeEvents(scored).map((e) => (byEvent[e.id] ? { ...e, grade: byEvent[e.id] } : e));
  return opts.includeStale ? events : events.filter((e) => !e.stale);
}

export function rowToEvent(row: Record<string, unknown>): RadarEvent {
  return {
    lastSeenAt: (row.last_seen_at as string) ?? undefined,
    id: row.external_id as string,
    dbId: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? "",
    date: (row.starts_at as string) ?? "",
    endDate: (row.ends_at as string) ?? undefined,
    location: (row.location as string) ?? "",
    url: row.url as string,
    source: remapSource(row.external_id as string, row.source as string),
    category: (row.category as string) ?? "general",
    imageUrl: (row.image_url as string) ?? undefined,
    leadScore: (row.lead_score as number) ?? undefined,
    leadTier: (row.lead_tier as "hot" | "warm" | "cold") ?? "cold",
    highLeverage: (row.high_leverage as boolean) ?? false,
    leverageReason: (row.leverage_reason as string) ?? undefined,
    acceptedAt: (row.accepted_at as string) ?? undefined,
    attendedAt: (row.attended_at as string) ?? undefined,
    cost: row.cost === null || row.cost === undefined ? undefined : Number(row.cost),
    currency: (row.currency as string) ?? undefined,
    debriefNotes: (row.debrief_notes as string) ?? undefined,
    organizerName: (row.organizer_name as string) ?? undefined,
    organizerLumaId: (row.organizer_luma_id as string) ?? undefined,
    organizerLinkedin: (row.organizer_linkedin as string) ?? undefined,
    organizerUsername: (row.organizer_username as string) ?? undefined,
  };
}
