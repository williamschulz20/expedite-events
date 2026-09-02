import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { db, BOOLEAN_COLUMNS } from "./db";

// ---------------------------------------------------------------------------
// Minimal PostgREST-compatible query builder over local SQLite.
//
// The Supabase project this app used was deleted. Rather than rewrite the ten
// API routes, this reimplements exactly the slice of the supabase-js surface
// they call: schema/from/select/eq/gte/lte/not/or/order/limit/single and
// insert/upsert/update/delete. Routes are untouched.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
// `any` mirrors supabase-js, whose responses are untyped at the call sites.
type Row = Record<string, any>;
type Filter =
  | { kind: "cmp"; col: string; op: "=" | ">=" | "<="; value: unknown }
  | { kind: "notNull"; col: string }
  | { kind: "raw"; sql: string };

type Result<T> = { data: T; error: { message: string } | null };

// SQLite accepts null/number/string/bigint/Uint8Array only.
function bind(v: unknown): null | number | string | bigint {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string" || typeof v === "bigint") return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function decode(row: Row | undefined): Row | null {
  if (!row) return null;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = BOOLEAN_COLUMNS.has(k) ? Boolean(v) : v;
  }
  return out;
}

// "team_members ( id, name )" -> embedded relation, PostgREST style.
function parseSelect(sel: string): { columns: string[]; embeds: string[] } {
  const embeds: string[] = [];
  const stripped = sel.replace(/([a-z_]+)\s*\(([^)]*)\)/gi, (_m, rel: string) => {
    embeds.push(rel);
    return "";
  });
  const columns = stripped
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "*");
  return { columns, embeds };
}

class Query<T = any[]> implements PromiseLike<Result<T>> {
  private table: string;
  private op: "select" | "insert" | "upsert" | "update" | "delete" | null = null;
  private sel = "*";
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private one = false;
  private payload: Row[] = [];
  private conflict: string[] = [];

  constructor(table: string) {
    this.table = table;
  }

  select(cols = "*") {
    this.sel = cols || "*";
    if (!this.op) this.op = "select";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ kind: "cmp", col, op: "=", value });
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters.push({ kind: "cmp", col, op: ">=", value });
    return this;
  }
  lte(col: string, value: unknown) {
    this.filters.push({ kind: "cmp", col, op: "<=", value });
    return this;
  }
  // Only `.not(col, "is", null)` is used in this codebase.
  not(col: string, _op: string, _value: unknown) {
    this.filters.push({ kind: "notNull", col });
    return this;
  }
  // e.g. "organizer_name.is.null,organizer_linkedin.is.null"
  or(expr: string) {
    const parts = expr.split(",").map((p) => {
      const [col, op, val] = p.split(".");
      if (op === "is" && val === "null") return `${col} IS NULL`;
      if (op === "eq") return `${col} = '${String(val).replace(/'/g, "''")}'`;
      return "1=0";
    });
    this.filters.push({ kind: "raw", sql: `(${parts.join(" OR ")})` });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  single() {
    this.one = true;
    return this as unknown as Query<any>;
  }

  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = [patch];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  private where(): { sql: string; params: (null | number | string | bigint)[] } {
    if (this.filters.length === 0) return { sql: "", params: [] };
    const parts: string[] = [];
    const params: (null | number | string | bigint)[] = [];
    for (const f of this.filters) {
      if (f.kind === "cmp") {
        parts.push(`${f.col} ${f.op} ?`);
        params.push(bind(f.value));
      } else if (f.kind === "notNull") {
        parts.push(`${f.col} IS NOT NULL`);
      } else {
        parts.push(f.sql);
      }
    }
    return { sql: ` WHERE ${parts.join(" AND ")}`, params };
  }

  private runSelect(): Row[] {
    const { sql, params } = this.where();
    let q = `SELECT * FROM ${this.table}${sql}`;
    if (this.orderBy) q += ` ORDER BY ${this.orderBy.col} ${this.orderBy.asc ? "ASC" : "DESC"}`;
    if (this.lim != null) q += ` LIMIT ${this.lim}`;
    const rows = db().prepare(q).all(...params) as Row[];
    const { columns, embeds } = parseSelect(this.sel);

    return rows.map((r) => {
      const decoded = decode(r)!;
      let out: Row = decoded;
      if (columns.length) {
        out = {};
        for (const c of columns) out[c] = decoded[c];
      }
      for (const rel of embeds) {
        // team_members -> team_member_id
        const fk = `${rel.replace(/s$/, "")}_id`;
        const id = decoded[fk];
        out[rel] = id
          ? decode(
              db().prepare(`SELECT * FROM ${rel} WHERE id = ?`).get(bind(id)) as Row | undefined
            )
          : null;
      }
      return out;
    });
  }

  private runWrite(): Row[] {
    const d = db();
    const now = new Date().toISOString();

    if (this.op === "update") {
      const patch = this.payload[0] ?? {};
      const keys = Object.keys(patch);
      if (!keys.length) return [];
      const { sql, params } = this.where();
      d.prepare(
        `UPDATE ${this.table} SET ${keys.map((k) => `${k} = ?`).join(", ")}${sql}`
      ).run(...keys.map((k) => bind(patch[k])), ...params);
      return this.runSelect();
    }

    if (this.op === "delete") {
      const { sql, params } = this.where();
      d.prepare(`DELETE FROM ${this.table}${sql}`).run(...params);
      return [];
    }

    // insert / upsert
    const written: Row[] = [];
    for (const raw of this.payload) {
      const row: Row = { ...raw };
      if (!row.id) row.id = randomUUID();
      if ("first_seen_at" in row === false && this.table === "scraped_events") {
        row.first_seen_at = now;
      }
      if (this.table === "event_attendance" || this.table === "team_members") {
        row.created_at ??= now;
      }
      const keys = Object.keys(row).filter((k) => row[k] !== undefined);
      const placeholders = keys.map(() => "?").join(", ");
      // Never let a re-scrape clobber identity or human-set state.
      const updatable = keys.filter(
        (k) => !["id", "first_seen_at", "accepted_at", "attended_at"].includes(k)
      );

      let sql = `INSERT INTO ${this.table} (${keys.join(", ")}) VALUES (${placeholders})`;
      if (this.op === "upsert") {
        sql +=
          updatable.length > 0
            ? ` ON CONFLICT (${this.conflict.join(", ")}) DO UPDATE SET ${updatable
                .map((k) => `${k} = excluded.${k}`)
                .join(", ")}`
            : ` ON CONFLICT (${this.conflict.join(", ")}) DO NOTHING`;
      } else {
        sql += " ON CONFLICT DO NOTHING";
      }

      d.prepare(sql).run(...keys.map((k) => bind(row[k])));

      // Read back so callers get server-generated columns.
      const lookupCol = this.op === "upsert" ? this.conflict[0] : "id";
      const back = d
        .prepare(`SELECT * FROM ${this.table} WHERE ${lookupCol} = ?`)
        .get(bind(row[lookupCol])) as Row | undefined;
      const dec = decode(back);
      if (dec) written.push(dec);
    }
    return written;
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    let out: Result<unknown>;
    try {
      const rows = this.op === "select" || this.op === null ? this.runSelect() : this.runWrite();
      out = this.one
        ? rows.length
          ? { data: rows[0], error: null }
          : { data: null, error: { message: "No rows found" } }
        : { data: rows, error: null };
    } catch (err) {
      out = { data: this.one ? null : [], error: { message: (err as Error).message } };
    }
    return Promise.resolve(out as Result<T>).then(onfulfilled, onrejected);
  }
}

class Client {
  // Postgres schemas do not exist in SQLite; everything lives in one file.
  schema(_name: string) {
    return this;
  }
  from(table: string) {
    return new Query(table);
  }
}

// ---------------------------------------------------------------------------
// Which backend?
//
// Local dev with no credentials -> the SQLite shim above (zero setup).
// Hosted (Vercel) with Supabase env vars -> the real supabase-js client, so the
// whole team shares one database. Same call sites either way.
// ---------------------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const usingHostedDatabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = usingHostedDatabase
  ? createSupabaseClient(SUPABASE_URL as string, SUPABASE_KEY as string, {
      auth: { persistSession: false },
    })
  : new Client();

// -----------------------------------------------------------------------
// Types mirroring scraped_events
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
