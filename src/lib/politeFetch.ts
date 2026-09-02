// ---------------------------------------------------------------------------
// Rate-limit-aware fetch.
//
// The original scrapers fired hundreds of concurrent requests, which gets the
// app 429'd within seconds (Luma) or served empty pages (Eventbrite). This
// wraps fetch with backoff, jitter and a global concurrency gate so a full
// sweep completes instead of being throttled into returning nothing.
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run tasks with a bounded number in flight, pausing between waves. */
export async function throttledBatch<T>(
  tasks: Array<() => Promise<T>>,
  { concurrency = 4, pauseMs = 400 }: { concurrency?: number; pauseMs?: number } = {}
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const wave = tasks.slice(i, i + concurrency).map((t) => t());
    const settled = await Promise.allSettled(wave);
    for (const r of settled) if (r.status === "fulfilled") out.push(r.value);
    if (i + concurrency < tasks.length) await sleep(pauseMs + Math.random() * pauseMs);
  }
  return out;
}

/** Fetch HTML, retrying on 429/5xx with exponential backoff. Returns "" on failure. */
export async function politeText(
  url: string,
  { retries = 3, timeoutMs = 20_000 }: { retries?: number; timeoutMs?: number } = {}
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt === retries) return "";
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1500 * 2 ** attempt + Math.random() * 800;
        await sleep(Math.min(wait, 30_000));
        continue;
      }

      if (!res.ok) return "";
      return await res.text();
    } catch {
      if (attempt === retries) return "";
      await sleep(1000 * 2 ** attempt);
    }
  }
  return "";
}

/** Fetch JSON with the same backoff. Returns null on failure. */
export async function politeJSON<T = unknown>(
  url: string,
  { retries = 3, timeoutMs = 30_000 }: { retries?: number; timeoutMs?: number } = {}
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt === retries) return null;
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * 2 ** attempt + Math.random() * 800, 30_000));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      if (attempt === retries) return null;
      await sleep(1000 * 2 ** attempt);
    }
  }
  return null;
}
