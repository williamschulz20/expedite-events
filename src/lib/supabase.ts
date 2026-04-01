import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);

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
