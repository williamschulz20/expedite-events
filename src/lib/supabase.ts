import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabase) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) {
        throw new Error("Supabase env vars not set — NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");
      }
      _supabase = createClient(url, key);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_supabase as any)[prop as string];
  },
});

// -----------------------------------------------------------------------
// Types mirroring event_scraper.scraped_events
// -----------------------------------------------------------------------
export interface ScrapedEvent {
  id: string;
  external_id: string;
  source: "luma" | "eventbrite" | "partiful" | "meetup";
  title: string;
  description: string | null;
  location: string | null;
  url: string;
  image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  category: string | null;
  lead_tier: "hot" | "warm" | "cold" | null;
  lead_score: number | null;
  rsvp_status: "pending" | "success" | "failed" | "skipped";
  rsvp_attempted_at: string | null;
  accepted_at: string | null;
  attended_at: string | null;
  promoted_to_event_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
}
