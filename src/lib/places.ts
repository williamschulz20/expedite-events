// Where an event is: city, country, region.
//
// Locations arrive in every shape: "Philadelphia, United States", "Austin, TX",
// "The Lincoln" (a bar, city only in the title), "Online", "TBD". The old
// client-side matcher knew 36 cities and nothing else, so 1,698 of 2,877
// upcoming events landed in "Other" and the region and country filters hid
// most of the data. This resolves venue, then title, then country and state
// hints, and runs on the server so every client sees the same answer.

export interface Place {
  city: string | null;
  country: string | null;
  region: string | null;
  /** IANA zone of the venue, when the city or a single-zone country gives one. */
  timeZone: string | null;
}

// Cities outside their country's default zone, or in multi-zone countries.
const CITY_ZONES: Record<string, string> = {
  "San Francisco": "America/Los_Angeles", "Los Angeles": "America/Los_Angeles", "Seattle": "America/Los_Angeles",
  "San Diego": "America/Los_Angeles", "Portland": "America/Los_Angeles", "Las Vegas": "America/Los_Angeles",
  "Denver": "America/Denver", "Boulder": "America/Denver", "Salt Lake City": "America/Denver", "Phoenix": "America/Phoenix",
  "Austin": "America/Chicago", "Chicago": "America/Chicago", "Dallas": "America/Chicago", "Houston": "America/Chicago",
  "Nashville": "America/Chicago", "Minneapolis": "America/Chicago",
  "New York": "America/New_York", "Boston": "America/New_York", "Washington DC": "America/New_York", "Miami": "America/New_York",
  "Atlanta": "America/New_York", "Philadelphia": "America/New_York", "Pittsburgh": "America/New_York", "Detroit": "America/New_York",
  "Raleigh": "America/New_York", "Ithaca": "America/New_York", "Baltimore": "America/New_York",
  "Toronto": "America/Toronto", "Montreal": "America/Toronto", "Ottawa": "America/Toronto", "Vancouver": "America/Vancouver", "Calgary": "America/Edmonton",
  "Sydney": "Australia/Sydney", "Melbourne": "Australia/Melbourne",
  "Sao Paulo": "America/Sao_Paulo", "Dubai": "Asia/Dubai", "Abu Dhabi": "Asia/Dubai",
};

const COUNTRY_ZONES: Record<string, string> = {
  "United Kingdom": "Europe/London", "Ireland": "Europe/Dublin", "Portugal": "Europe/Lisbon", "Iceland": "Atlantic/Reykjavik",
  "Germany": "Europe/Berlin", "France": "Europe/Paris", "Netherlands": "Europe/Amsterdam", "Spain": "Europe/Madrid",
  "Italy": "Europe/Rome", "Switzerland": "Europe/Zurich", "Austria": "Europe/Vienna", "Belgium": "Europe/Brussels",
  "Luxembourg": "Europe/Luxembourg", "Sweden": "Europe/Stockholm", "Norway": "Europe/Oslo", "Denmark": "Europe/Copenhagen",
  "Poland": "Europe/Warsaw", "Czechia": "Europe/Prague", "Hungary": "Europe/Budapest", "Croatia": "Europe/Zagreb",
  "Serbia": "Europe/Belgrade", "Slovenia": "Europe/Ljubljana", "Slovakia": "Europe/Bratislava", "Malta": "Europe/Malta",
  "Finland": "Europe/Helsinki", "Estonia": "Europe/Tallinn", "Latvia": "Europe/Riga", "Lithuania": "Europe/Vilnius",
  "Romania": "Europe/Bucharest", "Bulgaria": "Europe/Sofia", "Greece": "Europe/Athens", "Ukraine": "Europe/Kyiv", "Cyprus": "Asia/Nicosia",
  "Turkiye": "Europe/Istanbul", "Israel": "Asia/Jerusalem", "United Arab Emirates": "Asia/Dubai", "Saudi Arabia": "Asia/Riyadh",
  "Qatar": "Asia/Qatar", "Egypt": "Africa/Cairo", "India": "Asia/Kolkata", "Singapore": "Asia/Singapore", "Hong Kong": "Asia/Hong_Kong",
  "Japan": "Asia/Tokyo", "South Korea": "Asia/Seoul", "China": "Asia/Shanghai", "Taiwan": "Asia/Taipei", "Thailand": "Asia/Bangkok",
  "Malaysia": "Asia/Kuala_Lumpur", "Philippines": "Asia/Manila", "Vietnam": "Asia/Ho_Chi_Minh", "New Zealand": "Pacific/Auckland",
  "Argentina": "America/Argentina/Buenos_Aires", "Colombia": "America/Bogota", "Chile": "America/Santiago",
  "Nigeria": "Africa/Lagos", "Kenya": "Africa/Nairobi", "South Africa": "Africa/Johannesburg",
};

type CityDef = [name: string, country: string, aliases?: string[]];

// Order matters only where one name contains another; longer names first.
const CITIES: CityDef[] = [
  ["San Francisco", "United States", ["sf", "soma", "bay area", "silicon valley", "palo alto", "menlo park", "mountain view", "san jose", "santa clara", "sunnyvale", "oakland", "berkeley", "redwood city", "san mateo"]],
  ["New York", "United States", ["nyc", "manhattan", "brooklyn", "queens"]],
  ["Los Angeles", "United States", ["santa monica", "venice beach", "culver city", "pasadena"]],
  ["Washington DC", "United States", ["washington dc", "washington, dc", "washington d.c"]],
  ["Boston", "United States", ["cambridge, ma", "kendall sq", "kendall square"]],
  ["Seattle", "United States", ["bellevue, wa", "redmond"]],
  ["Austin", "United States"], ["Chicago", "United States"], ["Miami", "United States"],
  ["Denver", "United States"], ["Atlanta", "United States"], ["Dallas", "United States"],
  ["Houston", "United States"], ["San Diego", "United States"], ["Philadelphia", "United States"],
  ["Salt Lake City", "United States"], ["Nashville", "United States"], ["Portland", "United States"],
  ["Pittsburgh", "United States"], ["Detroit", "United States"], ["Minneapolis", "United States"],
  ["Phoenix", "United States"], ["Raleigh", "United States"], ["Boulder", "United States"],
  ["Ithaca", "United States"], ["Las Vegas", "United States"], ["Baltimore", "United States"],
  ["Toronto", "Canada"], ["Montreal", "Canada"], ["Vancouver", "Canada"], ["Ottawa", "Canada"], ["Calgary", "Canada"],
  ["London", "United Kingdom", ["shoreditch", "mayfair", "soho, london", "canary wharf", "king's cross", "kings cross", "croydon", "old street", "waterloo, london"]],
  ["Manchester", "United Kingdom"], ["Edinburgh", "United Kingdom"], ["Bristol", "United Kingdom"],
  ["Cambridge", "United Kingdom"], ["Oxford", "United Kingdom"], ["Cardiff", "United Kingdom"], ["Belfast", "United Kingdom"], ["Birmingham", "United Kingdom"], ["Glasgow", "United Kingdom"], ["Leeds", "United Kingdom"],
  ["Dublin", "Ireland"], ["Cork", "Ireland"],
  ["Berlin", "Germany"], ["Munich", "Germany", ["münchen", "muenchen"]], ["Hamburg", "Germany"], ["Frankfurt", "Germany"], ["Cologne", "Germany", ["köln"]], ["Stuttgart", "Germany"],
  ["Paris", "France"], ["Lyon", "France"],
  ["Amsterdam", "Netherlands"], ["Rotterdam", "Netherlands"], ["Eindhoven", "Netherlands"], ["Utrecht", "Netherlands"], ["The Hague", "Netherlands"],
  ["Barcelona", "Spain"], ["Madrid", "Spain"], ["Valencia", "Spain"],
  ["Lisbon", "Portugal", ["lisboa"]], ["Porto", "Portugal"],
  ["Milan", "Italy", ["milano"]], ["Rome", "Italy", ["roma"]], ["Turin", "Italy", ["torino"]],
  ["Zurich", "Switzerland", ["zürich"]], ["Geneva", "Switzerland", ["genève"]], ["Lausanne", "Switzerland"], ["Basel", "Switzerland"],
  ["Stockholm", "Sweden"], ["Gothenburg", "Sweden"], ["Helsinki", "Finland"], ["Oslo", "Norway"], ["Copenhagen", "Denmark", ["københavn"]],
  ["Vienna", "Austria", ["wien"]], ["Brussels", "Belgium", ["bruxelles"]], ["Luxembourg", "Luxembourg"],
  ["Warsaw", "Poland", ["warszawa"]], ["Krakow", "Poland", ["kraków"]], ["Prague", "Czechia", ["praha"]], ["Budapest", "Hungary"],
  ["Tallinn", "Estonia"], ["Tartu", "Estonia"], ["Riga", "Latvia"], ["Vilnius", "Lithuania"],
  ["Bucharest", "Romania"], ["Sofia", "Bulgaria"], ["Athens", "Greece"], ["Zagreb", "Croatia"], ["Belgrade", "Serbia"], ["Ljubljana", "Slovenia"],
  ["Istanbul", "Turkiye"], ["Valletta", "Malta"], ["Reykjavik", "Iceland"], ["Kyiv", "Ukraine", ["kiev"]],
  ["Tel Aviv", "Israel"], ["Dubai", "United Arab Emirates"], ["Abu Dhabi", "United Arab Emirates"], ["Riyadh", "Saudi Arabia"], ["Doha", "Qatar"],
  ["Singapore", "Singapore"], ["Hong Kong", "Hong Kong"], ["Tokyo", "Japan"], ["Seoul", "South Korea"], ["Bangalore", "India", ["bengaluru"]],
  ["Mumbai", "India"], ["Delhi", "India", ["new delhi", "gurgaon", "noida"]], ["Shanghai", "China"], ["Beijing", "China"], ["Taipei", "Taiwan"],
  ["Jakarta", "Indonesia"], ["Bangkok", "Thailand"], ["Kuala Lumpur", "Malaysia"], ["Manila", "Philippines"], ["Ho Chi Minh City", "Vietnam"],
  ["Sydney", "Australia"], ["Melbourne", "Australia"], ["Auckland", "New Zealand"],
  ["Sao Paulo", "Brazil", ["são paulo"]], ["Mexico City", "Mexico", ["cdmx", "ciudad de mexico"]], ["Buenos Aires", "Argentina"], ["Bogota", "Colombia", ["bogotá"]], ["Santiago", "Chile"],
  ["Lagos", "Nigeria"], ["Nairobi", "Kenya"], ["Cape Town", "South Africa"], ["Cairo", "Egypt"],
];

const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "United States", "usa": "United States", "u.s.": "United States",
  "united kingdom": "United Kingdom", "uk": "United Kingdom", "england": "United Kingdom", "scotland": "United Kingdom", "wales": "United Kingdom",
  "deutschland": "Germany", "nederland": "Netherlands", "the netherlands": "Netherlands", "españa": "Spain", "turkey": "Turkiye",
  "uae": "United Arab Emirates", "korea": "South Korea", "czech republic": "Czechia",
};

const COUNTRY_NAMES = [
  "United States", "Canada", "United Kingdom", "Ireland", "Germany", "France", "Netherlands", "Spain", "Portugal",
  "Italy", "Switzerland", "Austria", "Belgium", "Luxembourg", "Sweden", "Norway", "Denmark", "Finland", "Iceland",
  "Poland", "Czechia", "Hungary", "Estonia", "Latvia", "Lithuania", "Romania", "Bulgaria", "Greece", "Croatia",
  "Serbia", "Slovenia", "Slovakia", "Ukraine", "Malta", "Cyprus", "Turkiye", "Israel", "United Arab Emirates",
  "Saudi Arabia", "Qatar", "India", "Singapore", "Hong Kong", "Japan", "South Korea", "China", "Taiwan",
  "Indonesia", "Thailand", "Malaysia", "Philippines", "Vietnam", "Australia", "New Zealand", "Brazil", "Mexico",
  "Argentina", "Colombia", "Chile", "Nigeria", "Kenya", "South Africa", "Egypt", "Russia",
];

const US_STATES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
]);
const CA_PROVINCES = new Set(["on", "qc", "bc", "ab", "mb", "ns", "nb", "sk"]);

const EUROPE = new Set([
  "United Kingdom", "Ireland", "Germany", "France", "Netherlands", "Spain", "Portugal", "Italy", "Switzerland", "Austria",
  "Belgium", "Luxembourg", "Sweden", "Norway", "Denmark", "Finland", "Iceland", "Poland", "Czechia", "Hungary", "Estonia",
  "Latvia", "Lithuania", "Romania", "Bulgaria", "Greece", "Croatia", "Serbia", "Slovenia", "Slovakia", "Ukraine", "Malta",
  "Cyprus", "Turkiye", "Russia",
]);
const MIDDLE_EAST = new Set(["Israel", "United Arab Emirates", "Saudi Arabia", "Qatar", "Egypt"]);
const ASIA_PACIFIC = new Set(["India", "Singapore", "Hong Kong", "Japan", "South Korea", "China", "Taiwan", "Indonesia", "Thailand", "Malaysia", "Philippines", "Vietnam", "Australia", "New Zealand"]);
const LATAM = new Set(["Brazil", "Mexico", "Argentina", "Colombia", "Chile"]);
const AFRICA = new Set(["Nigeria", "Kenya", "South Africa"]);

export function regionOf(country: string | null): string | null {
  if (!country) return null;
  if (country === "Online") return "Online";
  if (country === "United States" || country === "Canada") return "North America";
  if (EUROPE.has(country)) return "Europe";
  if (MIDDLE_EAST.has(country)) return "Middle East";
  if (ASIA_PACIFIC.has(country)) return "Asia-Pacific";
  if (LATAM.has(country)) return "Latin America";
  if (AFRICA.has(country)) return "Africa";
  return null;
}

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^\p{L}\p{N},.' ]+/gu, " ").replace(/\s+/g, " ").trim()} `;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompiled: one regex per city with its aliases, word-bounded.
const CITY_PATTERNS = CITIES.map(([name, country, aliases]) => ({
  name,
  country,
  re: new RegExp(`(?:^|[\\s,(])(?:${[name, ...(aliases ?? [])].map((a) => escape(a.toLowerCase())).join("|")})(?=$|[\\s,).])`),
}));

function findCity(text: string): { name: string; country: string } | null {
  const t = norm(text);
  for (const c of CITY_PATTERNS) if (c.re.test(t)) return { name: c.name, country: c.country };
  return null;
}

function findCountry(text: string): string | null {
  const t = norm(text);
  for (const name of COUNTRY_NAMES) if (t.includes(` ${name.toLowerCase()}`)) return name;
  for (const [alias, name] of Object.entries(COUNTRY_ALIASES)) {
    if (new RegExp(`(?:^|[\\s,(])${escape(alias)}(?=$|[\\s,).])`).test(t)) return name;
  }
  // Trailing state / province code: "Austin, TX", "Salt Lake City, UT (USA)".
  const parts = text.split(",").map((p) => p.trim().toLowerCase().replace(/\(.*\)/, "").trim());
  for (const p of parts.slice(1)) {
    // Only a bare code, optionally with a ZIP: "TX", "CA 94103". "in person" is not Indiana.
    const m = /^([a-z]{2})(?:\s+\d{5})?$/.exec(p);
    if (!m) continue;
    if (US_STATES.has(m[1])) return "United States";
    if (CA_PROVINCES.has(m[1])) return "Canada";
  }
  return null;
}

const ONLINE_RE = /\b(online|virtual|zoom|webinar|livestream|remote)\b/i;

export function resolvePlace(location: string | null | undefined, title = ""): Place {
  const loc = location ?? "";
  if (ONLINE_RE.test(loc) && !findCity(loc)) return { city: null, country: "Online", region: "Online", timeZone: null };
  const city = findCity(loc) ?? findCity(title);
  const country = city?.country ?? findCountry(loc) ?? findCountry(title);
  const timeZone = (city && CITY_ZONES[city.name]) ?? (country ? COUNTRY_ZONES[country] : undefined) ?? null;
  return { city: city?.name ?? null, country, region: regionOf(country), timeZone };
}
