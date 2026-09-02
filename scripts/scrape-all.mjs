#!/usr/bin/env node
// Walk every source endpoint one at a time and persist results into SQLite
// via /api/ingest. Sequential and patient by design: firing all sources at
// once is what got the app rate-limited.

const BASE = process.env.BASE_URL ?? "http://localhost:3100";

// Heavy sources get a long budget; the rest are quick.
const SOURCES = [
  { name: "luma-scrape", ms: 900_000 },
  { name: "eventbrite",  ms: 900_000 },
  { name: "meetup",      ms: 300_000 },
  { name: "conferences", ms: 120_000 },
  { name: "confstech",   ms: 120_000 },
  { name: "devevents",   ms: 120_000 },
  { name: "garysguide",  ms: 120_000 },
  { name: "tentimes",    ms: 120_000 },
  { name: "startupgrind",ms: 120_000 },
  { name: "f6s",         ms: 120_000 },
  { name: "selectusa",   ms: 120_000 },
  { name: "university",  ms: 120_000 },
  { name: "websearch",   ms: 180_000 },
  { name: "googlesearch",ms: 180_000 },
  { name: "partiful",    ms: 120_000 },
];

async function getJSON(url, ms) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Optional: restrict to named sources, e.g. `node scripts/scrape-all.mjs eventbrite meetup`
const only = process.argv.slice(2);
const selected = only.length ? SOURCES.filter((s) => only.includes(s.name)) : SOURCES;

let grandTotal = 0;
for (const { name, ms } of selected) {
  const started = Date.now();
  try {
    const data = await getJSON(`${BASE}/api/${name}`, ms);
    const events = data.events ?? [];
    let upserted = 0;
    // Ingest in chunks so one oversized body cannot fail the whole source.
    for (let i = 0; i < events.length; i += 200) {
      const res = await fetch(`${BASE}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: events.slice(i, i + 200) }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = await res.json().catch(() => ({}));
      upserted += j.upserted ?? 0;
    }
    grandTotal += upserted;
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${name.padEnd(14)} scraped=${String(events.length).padStart(5)}  stored=${String(upserted).padStart(5)}  ${secs}s`);
  } catch (err) {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${name.padEnd(14)} FAILED after ${secs}s: ${err.message}`);
  }
}
console.log(`\ntotal newly stored: ${grandTotal}`);
