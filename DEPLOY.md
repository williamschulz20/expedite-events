# Shipping Event Radar to the team

Goal: everyone signs in with their Google account and sees the same events and
the same "who's going".

Three things need YOUR accounts. I cannot create them for you. Everything else
is done.

Budget ~25 minutes.

---

## 1. Database (Supabase) — ~10 min

The app needs one shared database. Local SQLite cannot be shared, and Vercel's
filesystem is read-only, so a hosted Postgres is required.

1. Create a project at supabase.com (free tier is fine).
2. Open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), run it.
   It creates the four tables, the constraints the upserts depend on, the
   foreign key the attendance avatars need, and seeds the team.
   Edit the names/emails in the seed block first if the team has changed.
3. Go to **Settings → API** and copy:
   - Project URL
   - **service_role** key (not the anon key)

## 2. Google sign-in — ~10 min

1. In Google Cloud Console: **APIs & Services → Credentials → Create
   credentials → OAuth client ID → Web application**.
2. Authorized JavaScript origins:
   - `http://localhost:3100`
   - `https://YOUR-APP.vercel.app`
3. Authorized redirect URIs:
   - `http://localhost:3100/api/auth/callback/google`
   - `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. Copy the Client ID and Client Secret.

You can add the Vercel URL after the first deploy and redeploy; sign-in simply
will not work until the redirect URI matches exactly.

## 3. Deploy (Vercel) — ~5 min

1. Import `williamschulz20/expedite-events` at vercel.com. Framework auto-detects.
2. Add environment variables (all Production):

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
   | `GOOGLE_CLIENT_ID` | from step 2 |
   | `GOOGLE_CLIENT_SECRET` | from step 2 |
   | `AUTH_SECRET` | run `openssl rand -base64 32` |
   | `AUTH_URL` | `https://YOUR-APP.vercel.app` |
   | `ALLOWED_EMAIL_DOMAIN` | `expedite.now` (optional but recommended) |

   Do **not** set `EVENTS_DB_PATH` in production.
3. Deploy.

`ALLOWED_EMAIL_DOMAIN` means only @expedite.now Google accounts can get in.
Without it, any Google account can sign in.

---

## Filling production with events

**Do not run the scrapers on Vercel.** They take 1–15 minutes, well past the
300s function limit, and they write cache files to a read-only filesystem.

Run them from a laptop, pointed at production:

```bash
# .env.local, on your machine
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

```bash
./start.sh 3100        # terminal 1
./refresh.sh 3100      # terminal 2
```

The scrapers run locally with no timeout and write straight into production
Postgres. The deployed app then just reads. Re-run whenever you want fresh
events; upserts are keyed on `external_id`, so nothing duplicates.

This is a manual step. If nobody runs it, the event list goes stale.

---

## Two things deliberately switched off

**The daily auto-RSVP cron is removed.** `vercel.json` used to run `/api/cron`
at 08:00 UTC, which fetched every event and auto-RSVP'd to all of them as
william@expedite.now. Unattended mass registration under a real identity is a
reputational and account risk, so it is not shipping. The endpoint still exists
if you deliberately want it back: re-add the `crons` block.

**The "RSVP Filtered" button** in the header posts to `/api/rsvp`, which submits
real registrations. Brief the team, or hide the button, before sharing the URL.

---

## Verify before sharing the link

In this order:

1. `/signin` → "Continue with Google" works and bounces back signed in.
2. `/api/team` returns the seeded members (proves the database connection).
3. `/api/events` returns `source: "supabase"` and a non-zero total.
4. Mark yourself going on an event, then open it in another browser as someone
   else — your avatar should be there.

Do not test `/api/luma-scrape` or `/api/eventbrite` against production. They
will time out by design.
