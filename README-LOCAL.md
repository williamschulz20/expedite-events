# Event Radar — local rebuild

The original app depended on a Supabase project that was deleted. This restores
it end to end with a local SQLite database, so it runs with no external account.

## Run it

```bash
./start.sh
```

Open http://localhost:3100 and pick your profile when prompted. The app has to
be running for the page to load; if the browser shows nothing, the server is
not up. Leave that terminal window open. Pass a port to use a different one:
`./start.sh 3200`.

## Fill it with events

The page shows whatever is already in the database. With the app running, in a
second terminal:

```bash
./refresh.sh
```

To refresh one source only: `./refresh.sh 3100 luma-scrape`

This walks every source one at a time and stores results in SQLite. It is slow
on purpose (see "Rate limits"). Run it as often as you like: events are upserted
on `external_id`, so re-runs update rather than duplicate, and the set grows.

## What changed from the original

| Area | Before | Now |
|---|---|---|
| Database | Supabase (deleted) | SQLite at `.data/events.db` |
| DB access | `@supabase/supabase-js` | `src/lib/supabase.ts`, a shim with the same API over SQLite |
| Luma host | `lu.ma` | `luma.com` (the old host now 301s) |
| Luma depth | HTML page, ~20 events, few weeks | Cursor-paginated API, rolling 365 days |
| Luma cities | 28 slugs, several wrong | 50 verified slugs, ids cached |
| Eventbrite batching | Broken: every request fired at once | Fixed: lazy thunks, 4 at a time |
| Rate limits | None; got 429'd into returning nothing | `src/lib/politeFetch.ts` retries with backoff |
| Scrape trigger | One request, 8s Vercel timeout | `scripts/scrape-all.mjs`, sequential, patient |
| Filters | Category, tier, source, city | Same plus a **Country** row above City |

The 2,598-line UI in `src/app/page.tsx` was not rewritten. The only change there
is the country filter. All ten API routes are untouched: the shim keeps the
`supabase.from(...).select(...)` calls working as they were.

## Source status

| Source | State |
|---|---|
| Luma | Working. 45 cities returning events, organizers included. |
| Meetup | Working. |
| Conferences / confstech | Working. These supply the far-future events. |
| Eventbrite | Code fixed, but this IP is currently 429'd. Retry after a cooldown. |
| garysguide, tentimes, devevents, f6s, partiful, websearch | Return 0. Their site markup changed; the selectors need rewriting. |

### Luma API notes

Two things cost real time, so they are written down:

1. The city page only ever exposes ~20 events. Depth comes from
   `https://api.lu.ma/discover/get-paginated-events`, which returns
   `has_more` + `next_cursor`.
2. That endpoint takes **`discover_place_api_id`**, not `place_api_id`. Passing
   the wrong name is not an error: it silently ignores the filter and falls back
   to IP geolocation, so every city returns the *same* local events. If every
   city suddenly shows London, this is why.

Place ids come from `https://api.lu.ma/discover/get-place?slug=<slug>` and are
cached in `.data/luma-places.json`. The slugs are Luma's own, not city names:
New York is `nyc`, San Francisco is `sf`, Washington DC is `dc`. Refresh with:

```bash
node scripts/resolve-places.mjs
```

## Rate limits

Both Luma and Eventbrite throttle aggressively. A full sweep that fires
everything at once returns **zero** events, which is what made the app look
broken. Scraping is now deliberately slow. If a source returns nothing, it is
usually a temporary 429 — wait a few minutes and re-run.

## Not done yet

- **Google sign-in.** The app identifies you with a profile picker backed by the
  `team_members` table. Real Google SSO needs a Google Cloud OAuth client
  (client ID + secret), which has to be created under your own account.
- **Shared hosting.** This runs on one machine, so the team cannot yet see each
  other's attendance. Deploying needs a Vercel account and a hosted Postgres;
  the shim is the only file that would change.
- **Auto-RSVP.** Deliberately left out. Automated RSVPs risk the account.
- **The six dead scrapers** above.
- **A year of dense coverage.** The 365-day window is enforced on every run, but
  most sources simply do not list that far ahead: organisers publish a few
  months out. Far-future coverage comes from the conferences list, so that is
  the file to extend if you want 2027 filled in.
