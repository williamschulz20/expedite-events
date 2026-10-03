-- ===========================================================================
-- Event Radar: attribution layer
--
-- The scraper answers "where are the founders?". This answers the question
-- that follows it: what did going there actually return?
--
-- Nothing here is destructive. Run it once in the Supabase SQL Editor on the
-- project the app points at; it is safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Event-level attribution.
--
-- `attended_at` and `accepted_at` already exist. What was missing is what the
-- event cost and whether anyone ever wrote down how it went, which is the
-- difference between a calendar and a record you can learn from.
-- ---------------------------------------------------------------------------
alter table public.scraped_events add column if not exists cost           numeric;
alter table public.scraped_events add column if not exists currency       text default 'GBP';
alter table public.scraped_events add column if not exists debrief_notes  text;
alter table public.scraped_events add column if not exists debriefed_at   timestamptz;
alter table public.scraped_events add column if not exists debriefed_by   text;
-- The matching record in the GTM platform, once this event has been promoted
-- there. `promoted_to_event_id` predates this and is kept for compatibility.
alter table public.scraped_events add column if not exists gtm_event_id   text;

-- ---------------------------------------------------------------------------
-- captured_leads: the people we actually met, one row per conversation.
--
-- Deliberately not the same thing as an attendee list. An attendee list is
-- who was in the room; this is who we spoke to and what we thought of them.
-- The rating is the whole point: an unrated row cannot teach the scorer
-- anything, which is why `lead_quality` is surfaced everywhere it appears.
-- ---------------------------------------------------------------------------
create table if not exists public.captured_leads (
  id                uuid primary key default gen_random_uuid(),
  event_external_id text not null,
  name              text not null,
  title             text,
  company           text,
  linkedin_url      text,
  email             text,
  lead_quality      text check (lead_quality in ('hot','warm','cold')),
  notes             text,
  -- Who had the conversation. Free text rather than a FK so a lead captured
  -- by someone who later leaves the team does not vanish with their row.
  captured_by       text,
  captured_at       timestamptz default now(),
  -- Links into the GTM platform, filled once the lead becomes a record there.
  gtm_person_id     text,
  gtm_deal_id       text,
  gtm_deal_name     text,
  gtm_deal_stage    text,
  gtm_deal_amount   numeric,
  gtm_deal_currency text,
  gtm_synced_at     timestamptz
);

create index if not exists idx_leads_event   on public.captured_leads (event_external_id);
create index if not exists idx_leads_quality on public.captured_leads (lead_quality);
create index if not exists idx_leads_deal    on public.captured_leads (gtm_deal_id);

-- One row per person per event. A second conversation with the same person at
-- the same event is an edit, not a new lead.
create unique index if not exists uq_leads_event_linkedin
  on public.captured_leads (event_external_id, linkedin_url)
  where linkedin_url is not null;

-- Same lock-down posture as the rest of the schema: server-side service-role
-- access only, so RLS on with no policies denies everything else.
alter table public.captured_leads enable row level security;
