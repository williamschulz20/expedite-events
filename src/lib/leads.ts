// Client-side types and fetch helpers for the attribution layer.
//
// Browser-safe: no secrets, no server imports. The route handlers under
// src/app/api/ are the only things that touch the database.

export type LeadQuality = "hot" | "warm" | "cold";

export const LEAD_QUALITIES: LeadQuality[] = ["hot", "warm", "cold"];

export interface CapturedLead {
  id: string;
  event_external_id: string;
  name: string;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  email: string | null;
  lead_quality: LeadQuality | null;
  notes: string | null;
  captured_by: string | null;
  captured_at: string | null;
  gtm_person_id: string | null;
  gtm_deal_id: string | null;
  gtm_deal_name: string | null;
  gtm_deal_stage: string | null;
  gtm_deal_amount: number | null;
  gtm_deal_currency: string | null;
}

export interface NewLead {
  event_external_id: string;
  name: string;
  title?: string;
  company?: string;
  linkedin_url?: string;
  email?: string;
  captured_by?: string | null;
}

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function fetchLeads(eventExternalId: string): Promise<CapturedLead[]> {
  const res = await fetch(`/api/leads?event_id=${encodeURIComponent(eventExternalId)}`);
  const { leads } = await asJson<{ leads: CapturedLead[] }>(res);
  return leads ?? [];
}

export async function fetchAllLeads(): Promise<Record<string, CapturedLead[]>> {
  const res = await fetch("/api/leads");
  const { leadsByEvent } = await asJson<{ leadsByEvent: Record<string, CapturedLead[]> }>(res);
  return leadsByEvent ?? {};
}

export async function createLead(lead: NewLead): Promise<CapturedLead> {
  const res = await fetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lead),
  });
  const { lead: created } = await asJson<{ lead: CapturedLead }>(res);
  return created;
}

export async function updateLead(
  id: string,
  patch: Partial<Pick<CapturedLead, "lead_quality" | "notes" | "title" | "company" | "linkedin_url" | "email">>
): Promise<CapturedLead> {
  const res = await fetch("/api/leads", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
  const { lead } = await asJson<{ lead: CapturedLead }>(res);
  return lead;
}

export async function deleteLead(id: string): Promise<void> {
  const res = await fetch("/api/leads", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  await asJson<{ success: true }>(res);
}

export interface DebriefPatch {
  dbId: string;
  cost?: number | null;
  currency?: string | null;
  debrief_notes?: string | null;
  debriefed_by?: string | null;
  attended?: boolean;
}

export async function saveDebrief(patch: DebriefPatch): Promise<void> {
  const res = await fetch("/api/debrief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await asJson<{ success: true }>(res);
}

// ---------------------------------------------------------------------------
// Derived numbers, shared by the event panel and the returns view so the two
// can never disagree about what an event produced.
// ---------------------------------------------------------------------------

export interface LeadTally {
  total: number;
  rated: number;
  unrated: number;
  hot: number;
  warm: number;
  cold: number;
  withDeal: number;
}

export function tallyLeads(leads: CapturedLead[]): LeadTally {
  const tally: LeadTally = { total: leads.length, rated: 0, unrated: 0, hot: 0, warm: 0, cold: 0, withDeal: 0 };
  for (const lead of leads) {
    if (lead.lead_quality) {
      tally.rated += 1;
      tally[lead.lead_quality] += 1;
    } else {
      tally.unrated += 1;
    }
    if (lead.gtm_deal_id) tally.withDeal += 1;
  }
  return tally;
}

/**
 * Cost per hot lead: the number that decides whether to go again. Null when
 * either half is missing, so the UI can say which one rather than showing a
 * zero that reads like a real result.
 */
export function costPerHotLead(cost: number | null | undefined, hot: number): number | null {
  if (cost === null || cost === undefined || !Number.isFinite(cost) || cost <= 0) return null;
  if (hot <= 0) return null;
  return cost / hot;
}

const MONEY = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export function formatMoney(amount: number, currency: string | null | undefined): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";
  return `${symbol}${MONEY.format(Math.round(amount))}`;
}
