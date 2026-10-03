-- ===========================================================================
-- Event Radar v2: grading and source health
--
-- Additive and safe to re-run. Run AFTER supabase/attribution.sql, in the
-- Supabase SQL Editor of the project the app points at.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- event_grades: one row per person per event they went to.
--
-- The scorer reads listings; this is what the room was actually like. Grades
-- flow back into scoring: the next edition of a series, or the next event by
-- the same organizer, moves up or down by how the team graded the last one
-- (src/lib/radar.ts). series_key and organizer_key are stored at grading time
-- so that lookup needs no join back to scraped_events, whose rows can be
-- re-keyed or deduplicated later.
-- ---------------------------------------------------------------------------
create table if not exists public.event_grades (
  id                uuid primary key default gen_random_uuid(),
  event_external_id text not null,
  team_member_id    text not null,
  -- How many founders were in the room.
  founder_density   text not null check (founder_density in ('none','few','some','lots')),
  -- People who looked like O-1A candidates: the number that matters most.
  visa_fit          integer not null default 0 check (visa_fit >= 0),
  -- The room was mostly service providers, recruiters or other sellers.
  sellers_heavy     boolean not null default false,
  verdict           text not null check (verdict in ('again','maybe','skip')),
  notes             text,
  -- 0-100, computed by the app from the answers above (src/lib/grade.ts).
  score             integer not null check (score between 0 and 100),
  series_key        text,
  organizer_key     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_external_id, team_member_id)
);

create index if not exists idx_grades_event     on public.event_grades (event_external_id);
create index if not exists idx_grades_series    on public.event_grades (series_key);
create index if not exists idx_grades_organizer on public.event_grades (organizer_key);

alter table public.event_grades enable row level security;

-- ---------------------------------------------------------------------------
-- source_runs: what each scraper did on each run.
--
-- The daily job used to report success while Eventbrite had failed for a week
-- and four sources returned nothing. One row per source per run makes that
-- visible in the app and lets the job fail loudly.
-- ---------------------------------------------------------------------------
create table if not exists public.source_runs (
  id          uuid primary key default gen_random_uuid(),
  run_id      text not null,
  source      text not null,
  ok          boolean not null,
  scraped     integer not null default 0,
  saved       integer not null default 0,
  error       text,
  duration_ms integer,
  finished_at timestamptz not null default now()
);

create index if not exists idx_source_runs_source on public.source_runs (source, finished_at desc);

alter table public.source_runs enable row level security;
