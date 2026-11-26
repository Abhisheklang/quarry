// The Quarry crawler: robots.txt aware, per-host politeness delays, small
// per-host concurrency, breadth-first inside an allowlisted path prefix.
// Hand-written — no crawl libraries.
import { extractPage } from "./text.ts";

export interface CrawledPage {
  url: string;
  source: string;
  title: string;
  headings: string;
  text: string;
}

export const USER_AGENT =
  "QuarryBot/1.0 (from-scratch search engine; respects robots.txt)";

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") {
        u.searchParams.delete(key);
      }
    }
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

// Robots.txt evaluation: rules from the "*" group plus a group naming
// our own agent when present. Patterns follow RFC 9309: "*" matches any
// sequence, a trailing "$" anchors the match to the end of the path, and
// when several rules match, the longest pattern wins (ties go to Allow).
function robotsPatternMatches(pattern: string, path: string): boolean {
  let p = pattern;
  let anchored = false;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const source = p
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

export class Robots {
  private disallow: string[] = [];
  private allow: string[] = [];

  static parse(body: string): Robots {
    const r = new Robots();
    // A robots.txt group can name several agents on consecutive user-agent
    // lines that share one rule block. Accumulate the group's agents and
    // apply its rules if any of them is "*" or our own agent. The group
    // ends at a blank line, or at a user-agent line that appears after
    // rules have already started.
    let agents = new Set<string>();
    let rulesStarted = false;
    const inOurGroup = () => agents.has("*") || agents.has("quarrybot");
    for (const line of body.split(/\r?\n/)) {
      let t = line.trim();
      if (!t) {
        agents = new Set();
        rulesStarted = false;
        continue;
      }
      if (t.startsWith("#")) continue;
      // A trailing comment ("Disallow: /private/ # keep out") is not part
      // of the rule value; strip it before matching.
      const hash = t.indexOf("#");
      if (hash >= 0) t = t.slice(0, hash).trim();
      if (!t) continue;
      const ua = t.match(/^user-agent:\s*(.+)$/i);
      if (ua) {
        if (rulesStarted) {
          agents = new Set();
          rulesStarted = false;
        }
        agents.add(ua[1].trim().toLowerCase());
        continue;
      }
      const dis = t.match(/^disallow:\s*(\S+)/i);
      if (dis) {
        rulesStarted = true;
        if (inOurGroup() && dis[1]) r.disallow.push(dis[1]);
        continue;
      }
      const allow = t.match(/^allow:\s*(\S+)/i);
      if (allow) {
        rulesStarted = true;
        if (inOurGroup() && allow[1]) r.allow.push(allow[1]);
        continue;
      }
      // Any other directive (allow, crawl-delay, ...) also means the
      // current group's rule block has started.
      if (t.includes(":")) rulesStarted = true;
    }
    return r;
  }

  static async load(origin: string): Promise<Robots> {
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return new Robots(); // no robots file: everything allowed
      const body = await readBodyCapped(res, MAX_ROBOTS_BYTES);
      if (body === null) return new Robots(); // oversized robots file: ignore it
      return Robots.parse(body);
    } catch {
      return new Robots(); // unreachable robots file: proceed, delays still apply
    }
  }

  allows(url: string): boolean {
    const path = new URL(url).pathname;
    let longestDisallow = -1;
    let longestAllow = -1;
    for (const d of this.disallow) {
      if (robotsPatternMatches(d, path)) longestDisallow = Math.max(longestDisallow, d.length);
    }
    for (const a of this.allow) {
      if (robotsPatternMatches(a, path)) longestAllow = Math.max(longestAllow, a.length);
    }
    if (longestDisallow < 0) return true;
    // Longest matching pattern wins; on a tie the Allow rule wins.
    return longestAllow >= longestDisallow;
  }
}

// Hard byte caps, enforced while streaming so an oversized body is aborted
// instead of fully buffered in memory first.
export const MAX_PAGE_BYTES = 3_000_000;
export const MAX_ROBOTS_BYTES = 512_000; // robots.txt files are tiny; 512 KB is generous

// Read a response body with a hard byte cap. Returns null when the body is
// over the cap (including when the content-length header already proves it).
export async function readBodyCapped(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  out += decoder.decode();
  return out;
}

export interface Source {
  name: string;
  seed: string;
  allowedPrefix: string; // only URLs starting with this string are followed
  maxPages: number;
}

export interface CrawlHooks {
  alreadyHave?: Set<string>; // URLs from a previous run to skip (resume)
  onPage?: (page: CrawledPage) => void;
  onProgress?: (source: string, fetched: number, queued: number, attempts: number) => void;
}

const SKIP_EXT = /\.(png|jpe?g|svg|gif|webp|ico|pdf|zip|tar|gz|mp4|webm|css|js|json|xml)$/i;

export async function crawlSource(
  source: Source,
  hooks: CrawlHooks = {},
  opts: { delayMs?: number; concurrency?: number } = {},
): Promise<number> {
  const delayMs = opts.delayMs ?? 200;
  const concurrency = opts.concurrency ?? 2;
  const seed = normalizeUrl(source.seed);
  if (!seed) throw new Error(`bad seed URL: ${source.seed}`);
  const origin = new URL(seed).origin;
  const robots = await Robots.load(origin);

  const seen = new Set<string>([seed]);
  // Final (post-redirect) URLs already stored in this crawl: two queued
  // URLs can redirect to the same page, and only the first may count.
  const storedFinals = new Set<string>();
  const queue: string[] = [seed];
  let fetched = 0;
  // Every fetch attempt counts toward the maxPages budget, not only
  // successful pages: stubs, error responses and failed fetches all
  // increment attempts, and the worker loop stops at the budget.
  let attempts = 0;
  let lastStart = 0;

  async function fetchOne(url: string): Promise<void> {
    attempts++;
    const wait = Math.max(0, lastStart + delayMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();

    let html: string | null = null;
    let finalUrl = url;

    // Fetch with redirects followed manually: every hop is revalidated
    // against the source allowlist prefix, so a redirect can never pull
    // content from outside the allowed tree. Returns null for a definitive
    // skip (bad status, bad redirect target, wrong type, oversized body);
    // network errors throw so the caller can retry them once.
    const MAX_REDIRECT_HOPS = 5;
    async function fetchValidated(
      start: string,
    ): Promise<{ body: string; finalUrl: string } | null> {
      let current = start;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        // Every hop is re-checked against robots.txt, not just the
        // originally queued URL: a redirect into a disallowed path must
        // not be fetched either.
        if (!robots.allows(current)) return null;
        const res = await fetch(current, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(20000),
          redirect: "manual",
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => {});
          if (!location || hop === MAX_REDIRECT_HOPS) return null;
          let next: string | null;
          try {
            next = normalizeUrl(new URL(location, current).toString());
          } catch {
            return null;
          }
          // normalizeUrl already restricts to http/https; the target must
          // also still live under the allowed prefix.
          if (!next || !next.startsWith(source.allowedPrefix)) return null;
          current = next;
          continue;
        }
        if (!res.ok) return null;
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("text/html")) return null;
        const body = await readBodyCapped(res, MAX_PAGE_BYTES);
        if (body === null) return null; // over the size cap
        return { body, finalUrl: current };
      }
      return null;
    }

    // One retry on a transient failure: a single dropped seed fetch would
    // otherwise silently zero out a whole source.
    for (let attempt = 0; attempt < 2 && html === null; attempt++) {
      try {
        const result = await fetchValidated(url);
        if (result === null) return;
        html = result.body;
        finalUrl = result.finalUrl;
      } catch (e) {
        if (attempt === 1) {
          // A failure the retry could not fix must be diagnosable: log
          // the URL and the cause instead of vanishing into a count.
          console.error(
            `crawl: fetch failed for ${url}: ${e instanceof Error ? e.message : String(e)}`,
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (html === null) return;

    // Links resolve against the FINAL url (after redirects, trailing slash
    // intact) — resolving "assert.html" against the normalised ".../api"
    // would drop the last segment and leave the docs tree entirely.
    // Extraction is guarded: one malformed page must be skipped, never
    // abort the whole crawl.
    let extracted;
    try {
      extracted = extractPage(html, finalUrl);
    } catch (e) {
      console.error(
        `crawl: extraction failed for ${finalUrl}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    const { title, headings, text, links } = extracted;
    if (text.length < 200) return; // a stub or redirect shell, not a document
    // Redirect aliasing: another queued URL already landed on this final
    // URL in this crawl. Do not count or store the same page twice.
    if (storedFinals.has(finalUrl)) return;
    storedFinals.add(finalUrl);
    seen.add(finalUrl);
    fetched++;
    // On a resumed run, pages already stored are traversed for their links
    // but not stored twice. Pages are stored under their final validated
    // URL (after any redirects), not the originally queued one.
    if (!hooks.alreadyHave?.has(finalUrl)) {
      hooks.onPage?.({ url: finalUrl, source: source.name, title, headings, text });
    }
    hooks.onProgress?.(source.name, fetched, queue.length, attempts);

    for (const link of links) {
      // Bound queue and seen growth to the budget: once maxPages distinct
      // URLs are known, no further links are enqueued, because the
      // attempts budget could never fetch them anyway.
      if (seen.size >= source.maxPages) break;
      const n = normalizeUrl(link);
      if (!n || seen.has(n)) continue;
      if (!n.startsWith(source.allowedPrefix)) continue;
      if (SKIP_EXT.test(new URL(n).pathname)) continue;
      seen.add(n);
      // Enqueued either way: pages already stored are still traversed so
      // the crawl can reach deeper pages through them.
      queue.push(n);
    }
  }

  // Small worker pool sharing the queue; the per-host start delay above is
  // enforced across all workers, so politeness holds under concurrency.
  // A worker that finds the queue momentarily empty waits while a sibling
  // fetch is still in flight, because that fetch may enqueue more links.
  // It exits only when the queue is empty AND nothing is in flight (so no
  // new links can arrive), or when the page budget is spent. Pages already
  // stored from a previous run are still fetched to expand their links;
  // fetchOne skips storing them again.
  let inFlight = 0;
  async function worker(): Promise<void> {
    for (;;) {
      if (attempts >= source.maxPages || fetched >= source.maxPages) return;
      const url = queue.shift();
      if (url === undefined) {
        if (inFlight === 0) return;
        await new Promise((r) => setTimeout(r, 5));
        continue;
      }
      if (!robots.allows(url)) continue;
      inFlight++;
      try {
        await fetchOne(url);
      } finally {
        inFlight--;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return fetched;
}
