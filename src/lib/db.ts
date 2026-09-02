import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Local SQLite store. Replaces the deleted Supabase project.
// Single file on disk; no external service, no account, no native build step
// (node:sqlite ships with Node 22+).
// ---------------------------------------------------------------------------

const DB_PATH =
  process.env.EVENTS_DB_PATH ?? path.join(process.cwd(), ".data", "events.db");

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA foreign_keys = ON;");
  migrate(_db);
  seedTeam(_db);
  return _db;
}

// Columns the UI expects as real booleans rather than SQLite 0/1.
export const BOOLEAN_COLUMNS = new Set([
  "high_leverage",
  "calendar_setup_done",
]);

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS scraped_events (
      id                  TEXT PRIMARY KEY,
      external_id         TEXT NOT NULL UNIQUE,
      source              TEXT,
      title               TEXT,
      description         TEXT,
      location            TEXT,
      url                 TEXT,
      image_url           TEXT,
      starts_at           TEXT,
      ends_at             TEXT,
      category            TEXT,
      lead_tier           TEXT,
      lead_score          INTEGER,
      high_leverage       INTEGER DEFAULT 0,
      leverage_reason     TEXT,
      rsvp_status         TEXT DEFAULT 'skipped',
      rsvp_attempted_at   TEXT,
      accepted_at         TEXT,
      attended_at         TEXT,
      promoted_to_event_id TEXT,
      organizer_name      TEXT,
      organizer_luma_id   TEXT,
      organizer_linkedin  TEXT,
      organizer_username  TEXT,
      first_seen_at       TEXT,
      last_seen_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_starts  ON scraped_events(starts_at);
    CREATE INDEX IF NOT EXISTS idx_events_tier    ON scraped_events(lead_tier);
    CREATE INDEX IF NOT EXISTS idx_events_orgname ON scraped_events(organizer_name);

    CREATE TABLE IF NOT EXISTS organizers (
      id              TEXT PRIMARY KEY,
      luma_user_id    TEXT UNIQUE,
      name            TEXT UNIQUE,
      username        TEXT,
      avatar_url      TEXT,
      website         TEXT,
      email           TEXT,
      bio             TEXT,
      linkedin_url    TEXT,
      linkedin_handle TEXT,
      twitter_handle  TEXT,
      primary_city    TEXT,
      last_seen_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      email                TEXT,
      initials             TEXT,
      avatar_color         TEXT,
      calendar_setup_done  INTEGER DEFAULT 0,
      created_at           TEXT
    );

    CREATE TABLE IF NOT EXISTS event_attendance (
      id                 TEXT PRIMARY KEY,
      event_external_id  TEXT NOT NULL,
      team_member_id     TEXT NOT NULL,
      status             TEXT DEFAULT 'going',
      created_at         TEXT,
      UNIQUE (event_external_id, team_member_id)
    );
    CREATE INDEX IF NOT EXISTS idx_att_event ON event_attendance(event_external_id);
  `);
}

// The Expedite team; ids stay deterministic (tm-<name>) across environments.
const TEAM = [
  { name: "William", initials: "W",  color: "#6366f1", email: "william@expedite.now" },
  { name: "Leeho",   initials: "L",  color: "#ec4899", email: "leeho@expedite.now" },
  { name: "Tom",     initials: "T",  color: "#8b5cf6", email: "tom@expedite.now" },
  { name: "Chanwoo", initials: "C",  color: "#14b8a6", email: "chanwoo@expedite.now" },
  { name: "Quan",    initials: "Q",  color: "#f59e0b", email: "quan@expedite.now" },
  { name: "Omar",    initials: "O",  color: "#0ea5e9", email: "omar@expedite.now" },
  { name: "Sagar",   initials: "SA", color: "#22c55e", email: "sagar@expedite.now" },
  { name: "Shams",   initials: "SH", color: "#ef4444", email: "shams@expedite.now" },
];

function seedTeam(d: DatabaseSync) {
  const row = d.prepare("SELECT COUNT(*) AS n FROM team_members").get() as { n: number };
  if (row.n > 0) return;
  const stmt = d.prepare(
    `INSERT INTO team_members (id, name, email, initials, avatar_color, calendar_setup_done, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  );
  TEAM.forEach((m, i) => {
    // Deterministic ids keep attendance stable across rebuilds of the file.
    const created = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    stmt.run(`tm-${m.name.toLowerCase()}`, m.name, m.email, m.initials, m.color, created);
  });
}
