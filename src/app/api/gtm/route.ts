import { NextResponse } from "next/server";
import {
  dealsByEvent,
  gtmConfigured,
  listGtmDeals,
  listGtmEvents,
  GtmError,
  type GtmDeal,
} from "@/lib/gtm";

export const dynamic = "force-dynamic";

// Read-only window onto the GTM platform.
//
// The token is server-side only, so the browser never talks to GTM directly;
// it asks this route, which is also the one place that decides what a
// disconnected GTM looks like to the UI.

type DealSummary = {
  id: string;
  name: string;
  stage: string | null;
  amount: number | null;
  currency: string | null;
  company: string | null;
};

function summarise(deal: GtmDeal): DealSummary {
  const amount = Number(deal.amount);
  return {
    id: deal.id,
    name: deal.name,
    stage: deal.stage,
    amount: Number.isFinite(amount) ? amount : null,
    currency: deal.currency,
    company: deal.company?.name ?? null,
  };
}

// GET /api/gtm
//   { connected, events: [...], dealsByEventId: { [gtmEventId]: DealSummary[] } }
export async function GET() {
  if (!gtmConfigured) {
    // Not an error. The app is designed to run before the token exists, and
    // the UI shows a "connect GTM" state rather than a failure.
    return NextResponse.json({
      connected: false,
      reason: "GTM_API_TOKEN is not set",
      events: [],
      dealsByEventId: {},
    });
  }

  try {
    const [events, deals] = await Promise.all([
      listGtmEvents({ limit: 200 }),
      listGtmDeals({ limit: 200 }),
    ]);

    const grouped = dealsByEvent(deals);
    const dealsByEventId: Record<string, DealSummary[]> = {};
    for (const [eventId, eventDeals] of grouped) {
      dealsByEventId[eventId] = eventDeals.map(summarise);
    }

    return NextResponse.json({
      connected: true,
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        location: event.location,
        startDate: event.startDate,
        url: event.url,
        cost: event.cost === null ? null : Number(event.cost),
        status: event.status,
        owner: event.owner
          ? [event.owner.firstName, event.owner.lastName].filter(Boolean).join(" ") ||
            event.owner.email
          : null,
      })),
      dealsByEventId,
      // Deals with no event credited. This number is the size of the problem
      // the whole attribution layer exists to shrink, so it is worth showing.
      unattributedDealCount: deals.filter((deal) => !deal.eventId).length,
    });
  } catch (err) {
    const status = err instanceof GtmError ? err.status : 500;
    const reason = err instanceof Error ? err.message : "GTM request failed";
    console.error("GTM GET error:", err);
    return NextResponse.json(
      { connected: false, reason, events: [], dealsByEventId: {} },
      { status: status === 401 || status === 503 ? 200 : status }
    );
  }
}
