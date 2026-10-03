// ---------------------------------------------------------------------------
// Client for the Expedite GTM platform's public API.
//
// GTM exposes an oRPC surface at `/public/<namespace>/<procedure>`, gated by an
// `xpd_…` bearer token. The wire format is oRPC's own: the request body is
// `{ json, meta }` and so is the response, where `meta` carries type markers
// for values JSON cannot express on its own (dates, bigints, sets).
//
// We read `.json` and ignore `meta` deliberately. The only marked type GTM
// returns is Date, and this app already works in ISO strings end to end, so
// the marker would tell us something we do not act on. That lets the whole
// client be one `fetch` rather than a dependency on @orpc/client.
//
// Server-only: the token must never reach the browser. Everything here is
// called from route handlers under src/app/api/gtm/.
// ---------------------------------------------------------------------------

const GTM_API_URL = process.env.GTM_API_URL?.replace(/\/$/, "") ?? "https://api.gtm.expedite.now";
const GTM_API_TOKEN = process.env.GTM_API_TOKEN?.trim();

/**
 * Whether the GTM link is switched on. Every panel that reads GTM checks this
 * first and renders a "not connected" state rather than an error, so the app
 * is fully usable before the token is issued.
 */
export const gtmConfigured = Boolean(GTM_API_TOKEN);

export class GtmError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GtmError";
    this.status = status;
  }
}

/** One call against the public API. `path` is "<namespace>/<procedure>". */
async function gtmCall<T>(path: string, input: unknown = {}): Promise<T> {
  if (!GTM_API_TOKEN) {
    throw new GtmError("GTM_API_TOKEN is not set", 503);
  }

  const res = await fetch(`${GTM_API_URL}/public/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GTM_API_TOKEN}`,
    },
    body: JSON.stringify({ json: input, meta: [] }),
    // GTM data changes on a human timescale and every caller here is a route
    // handler with its own cache policy, so never reuse a fetch-level cache.
    cache: "no-store",
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    // Errors come back in the same envelope, with the oRPC code inside.
    const message =
      (payload as { json?: { message?: string } } | null)?.json?.message ??
      `GTM request failed (${res.status})`;
    throw new GtmError(message, res.status);
  }

  return (payload as { json: T }).json;
}

// ---------------------------------------------------------------------------
// Shapes. Hand-written rather than imported: the GTM types live in a separate
// pnpm workspace this app is not part of, and only these fields are read here.
// ---------------------------------------------------------------------------

export interface GtmEvent {
  id: string;
  name: string;
  eventType: string | null;
  status: string | null;
  location: string | null;
  url: string | null;
  startDate: string | null;
  endDate: string | null;
  cost: string | null;
  notes: string | null;
  owner: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
}

export interface GtmDeal {
  id: string;
  name: string;
  stage: string | null;
  amount: string | null;
  currency: string | null;
  eventId: string | null;
  primaryContactId: string | null;
  createdAt: string | null;
  actualCloseDate: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; firstName: string | null; lastName: string | null } | null;
}

export interface GtmPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
  source: string | null;
  sourceDetail: string | null;
}

interface ListArgs {
  limit?: number;
  offset?: number;
}

// oRPC's pagination schema defaults `filters` to [], but the default only
// applies when the key is absent from the parsed object, so it is safe to omit.
export function listGtmEvents(args: ListArgs = {}): Promise<GtmEvent[]> {
  return gtmCall<GtmEvent[]>("events/list", { limit: args.limit ?? 200, offset: args.offset ?? 0 });
}

export function listGtmDeals(args: ListArgs = {}): Promise<GtmDeal[]> {
  return gtmCall<GtmDeal[]>("deals/list", { limit: args.limit ?? 200, offset: args.offset ?? 0 });
}

export function listGtmPeople(args: ListArgs = {}): Promise<GtmPerson[]> {
  return gtmCall<GtmPerson[]>("people/list", { limit: args.limit ?? 200, offset: args.offset ?? 0 });
}

export function getGtmEvent(id: string): Promise<GtmEvent & { leads?: unknown[] }> {
  return gtmCall("events/getById", { id });
}

/**
 * Deals grouped by the event they credit. Deals with no `eventId` are dropped
 * rather than bucketed under "unknown": this map exists to answer what a given
 * event returned, and an unattributed deal has no answer to contribute.
 */
export function dealsByEvent(deals: GtmDeal[]): Map<string, GtmDeal[]> {
  const map = new Map<string, GtmDeal[]>();
  for (const deal of deals) {
    if (!deal.eventId) continue;
    const bucket = map.get(deal.eventId);
    if (bucket) bucket.push(deal);
    else map.set(deal.eventId, [deal]);
  }
  return map;
}
