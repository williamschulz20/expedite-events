#!/usr/bin/env node
// Resolve Luma discover-place ids one slug at a time. Luma rate-limits hard,
// so this is deliberately slow. Results are cached permanently, so it is a
// one-time cost per city.
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), ".data", "luma-places.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SLUGS = process.argv.slice(2).length ? process.argv.slice(2) : [
  "nyc","sf","la","bay-area","palo-alto","brooklyn","seattle","austin","boston",
  "chicago","miami","denver","toronto","vancouver","montreal","atlanta","dc",
  "philadelphia","san-diego","dallas","houston","portland","phoenix","nashville",
  "slc","pittsburgh","detroit","minneapolis","boulder","raleigh","san-jose",
  "london","berlin","paris","amsterdam","munich","barcelona","lisbon","stockholm",
  "helsinki","dublin","zurich","copenhagen","vienna","madrid","warsaw","brussels",
  "geneva","hamburg","milan","rome","budapest","prague","tallinn","oslo",
  "manchester","edinburgh","cambridge","oxford","bristol","porto","valencia",
  "krakow","bucharest","sofia","athens","istanbul","riga","vilnius","ljubljana",
  "zagreb","luxembourg","rotterdam","eindhoven","cologne","frankfurt","stuttgart",
  "dusseldorf","leipzig","lyon","marseille","turin","florence","naples","seville",
  "malaga","bilbao","gothenburg","malmo","aarhus","bergen","reykjavik","belfast",
  "glasgow","leeds",
];

let places = {};
try { places = JSON.parse(fs.readFileSync(FILE, "utf-8")); } catch {}

const todo = SLUGS.filter((s) => !places[s]);
console.log(`${Object.keys(places).length} cached, ${todo.length} to resolve`);

let added = 0, blocked = 0;
for (const slug of todo) {
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    const res = await fetch(`https://api.lu.ma/discover/get-place?slug=${encodeURIComponent(slug)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);

    if (!res) { await sleep(3000); continue; }
    if (res.status === 429) { blocked++; await sleep(8000 * (attempt + 1)); continue; }
    if (!res.ok) { done = true; console.log(`  ${slug}: HTTP ${res.status}`); break; }

    const j = await res.json().catch(() => null);
    const id = j?.place?.api_id;
    if (id) { places[slug] = id; added++; console.log(`  ${slug} -> ${id}`); }
    else console.log(`  ${slug}: no place`);
    done = true;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(places, null, 2));
  await sleep(2500 + Math.random() * 1500);
}
console.log(`\nresolved ${added} new, ${blocked} rate-limit retries, ${Object.keys(places).length} total`);
