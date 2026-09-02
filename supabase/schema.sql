-- ===========================================================================
-- Event Radar — Supabase / Postgres schema
--
-- Recreates the database that was lost when the original Supabase project was
-- deleted. Mirrors src/lib/db.ts (the local SQLite store) so the same code
-- works against either backend.
--
-- Run this once in the Supabase SQL Editor on a fresh project.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- scraped_events
-- ---------------------------------------------------------------------------
create table if not exists public.scraped_events (
  id                   uuid primary key default gen_random_uuid(),
  external_id          text not null unique,          -- every upsert conflicts on this
  source               text,
  title                text,
  description          text,
  location             text,
  url                  text,
  image_url            text,
  starts_at            timestamptz,
  ends_at              timestamptz,
  category             text,
  lead_tier            text check (lead_tier in ('hot','warm','cold')),
  lead_score           integer,
  high_leverage        boolean default false,
  leverage_reason      text,
  rsvp_status          text default 'skipped',
  rsvp_attempted_at    timestamptz,
  accepted_at          timestamptz,
  attended_at          timestamptz,
  promoted_to_event_id text,
  organizer_name       text,
  organizer_luma_id    text,
  organizer_linkedin   text,
  organizer_username   text,
  first_seen_at        timestamptz default now(),
  last_seen_at         timestamptz default now()
);

create index if not exists idx_events_starts  on public.scraped_events (starts_at);
create index if not exists idx_events_tier    on public.scraped_events (lead_tier);
create index if not exists idx_events_orgname on public.scraped_events (organizer_name);

-- ---------------------------------------------------------------------------
-- organizers  (the "champions" — who hosts the events worth attending)
-- ---------------------------------------------------------------------------
create table if not exists public.organizers (
  id              uuid primary key default gen_random_uuid(),
  luma_user_id    text unique,
  name            text unique,     -- enrich-organizers upserts on name when there is no luma id
  username        text,
  avatar_url      text,
  website         text,
  email           text,
  bio             text,
  linkedin_url    text,
  linkedin_handle text,
  twitter_handle  text,
  primary_city    text,
  last_seen_at    timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  id                  text primary key,   -- deterministic ids, e.g. 'tm-william'
  name                text not null,
  email               text,
  initials            text,
  avatar_color        text,
  calendar_setup_done boolean default false,
  created_at          timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- event_attendance  (who on the team is going to what)
--
-- The FK below is NOT optional: /api/attendance selects the embedded relation
-- `team_members ( id, name, initials, avatar_color )`. PostgREST can only
-- resolve that embed if a real foreign key exists. Without it the attendance
-- avatars silently come back empty.
-- ---------------------------------------------------------------------------
create table if not exists public.event_attendance (
  id                uuid primary key default gen_random_uuid(),
  event_external_id text not null,
  team_member_id    text not null references public.team_members (id) on delete cascade,
  status            text default 'going' check (status in ('going','maybe')),
  created_at        timestamptz default now(),
  unique (event_external_id, team_member_id)
);

create index if not exists idx_att_event on public.event_attendance (event_external_id);

-- ---------------------------------------------------------------------------
-- Seed the team. Ids match src/lib/db.ts so local and hosted data line up.
-- Edit the names/emails to match your actual team before running.
-- ---------------------------------------------------------------------------
insert into public.team_members (id, name, email, initials, avatar_color) values
  ('tm-william', 'William', 'william@expedite.now', 'W', '#6366f1'),
  ('tm-leeho',   'Leeho',   '',                     'L', '#ec4899'),
  ('tm-quentin', 'Quentin', '',                     'Q', '#14b8a6'),
  ('tm-lucas',   'Lucas',   '',                     'L', '#f59e0b'),
  ('tm-tom',     'Tom',     '',                     'T', '#8b5cf6')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Lock the data down.
--
-- The app talks to Postgres only from server-side route handlers using the
-- SERVICE ROLE key, which bypasses RLS. Enabling RLS with no policies means
-- nothing can be read or written with the public anon key, even if it leaks.
-- ---------------------------------------------------------------------------
alter table public.scraped_events   enable row level security;
alter table public.organizers       enable row level security;
alter table public.team_members     enable row level security;
alter table public.event_attendance enable row level security;
