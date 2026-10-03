#!/usr/bin/env node
// Walk every source endpoint one at a time and persist results via
// /api/ingest. Sequential and patient by design: firing all sources at once
// is what got the app rate-limited.
//
// Each source's outcome is recorded through /api/source-runs so the app can
// show which feeds are healthy, and the run exits non-zero when a core source
// fails or comes back empty, so a broken feed turns the GitHub Action red
// instead of hiding behind a green tick.

import http from "node:http";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const RUN_ID = process.env.GITHUB_RUN_ID ?? `local-${new Date().toISOString()}`;

// Core sources carry most of the useful events. One failing or returning
// nothing fails the run.
const CORE = new Set(["luma-scrape", "eventbrite", "meetup", "garysguide", "devevents"]);

// Retired, not scheduled: tentimes (Cloudflare challenge on every page), f6s
// (Imperva challenge, robots.txt disallows all), googlesearch and university
// (search engines return nothing to scripted requests). Their routes still
// exist for manual use; the daily run no longer pretends they work.
const SOURCES = [
  { name: "luma-scrape",  ms: 900_000 },
  { name: "eventbrite",   ms: 600_000, batches: eventbriteBatches() },
  { name: "meetup",       ms: 300_000 },
  { name: "conferences",  ms: 120_000 },
  { name: "confstech",    ms: 120_000 },
  { name: "devevents",    ms: 120_000 },
  { name: "garysguide",   ms: 120_000 },
  { name: "startupgrind", ms: 120_000 },
  { name: "selectusa",    ms: 120_000 },
  { name: "websearch",    ms: 300_000 },
  { name: "partiful",     ms: 120_000 },
];

// The 18 strongest Eventbrite markets, six at a time. One call for all of
// them runs past any request timeout and gets the runner blocked.
function eventbriteBatches() {
  const out = [];
  for (let start = 0; start < 18; start += 6) out.push(`cityStart=${start}&cities=6`);
  return out;
}

// node:http rather than fetch: fetch gives up waiting for response headers
// after 300s whatever signal it is given, which is exactly how Eventbrite
// "failed after 301s" every day.
function getJSON(url, ms) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("response was not JSON"));
        }
      });
    });
    req.setTimeout(ms, () => req.destroy(new Error(`timed out after ${Math.round(ms / 1000)}s`)));
    req.on("error", reject);
  });
}

async function ingest(events) {
  let saved = 0;
  // Chunks so one oversized body cannot fail the whole source.
  for (let i = 0; i < events.length; i += 200) {
    const res = await fetch(`${BASE}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: events.slice(i, i + 200) }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await res.json().catch(() => ({}));
    saved += j.upserted ?? 0;
  }
  return saved;
}

async function record(run) {
  await fetch(`${BASE}/api/source-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: RUN_ID, ...run }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {});
}

// Optional: restrict to named sources, e.g. `node scripts/scrape-all.mjs eventbrite meetup`
const only = process.argv.slice(2);
const selected = only.length ? SOURCES.filter((s) => only.includes(s.name)) : SOURCES;

const failedCore = [];
let grandTotal = 0;

for (const { name, ms, batches } of selected) {
  const started = Date.now();
  let scraped = 0;
  let saved = 0;
  let error = null;
  let note = "";
  for (const query of batches ?? [""]) {
    try {
      const data = await getJSON(`${BASE}/api/${name}${query ? `?${query}` : ""}`, ms);
      const events = data.events ?? [];
      scraped += events.length;
      saved += await ingest(events);
      if (data.rate_limited) {
        note = " (rate-limited, partial)";
        break;
      }
    } catch (err) {
      error = err.message;
      break;
    }
  }
  const ok = !error && scraped > 0;
  if (!ok && !error) error = "returned no events";
  grandTotal += saved;
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    ok
      ? `${name.padEnd(14)} scraped=${String(scraped).padStart(5)}  saved=${String(saved).padStart(5)}  ${secs}s${note}`
      : `${name.padEnd(14)} FAILED after ${secs}s: ${error}${scraped ? ` (scraped ${scraped} first)` : ""}`
  );
  await record({ source: name, ok, scraped, saved, error: ok ? (note.trim() || null) : error, durationMs: Date.now() - started });
  if (!ok && CORE.has(name)) failedCore.push(name);
}

console.log(`\ntotal saved (new or refreshed): ${grandTotal}`);
if (failedCore.length) {
  console.error(`\nCore sources failed: ${failedCore.join(", ")}`);
  process.exit(1);
}
