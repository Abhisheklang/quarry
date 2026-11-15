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

// Minimal robots.txt evaluation: rules from the "*" group plus a group
// naming our own agent when present. Prefix matching on Disallow paths.
export class Robots {
  private disallow: string[] = [];

  static parse(body: string): Robots {
    const r = new Robots();
    let inOurGroup = false;
    for (const line of body.split(/\r?\n/)) {
      const t = line.trim();
      const ua = t.match(/^user-agent:\s*(.+)$/i);
      if (ua) {
        const agent = ua[1].trim().toLowerCase();
        inOurGroup = agent === "*" || agent === "quarrybot";
        continue;
      }
      const dis = t.match(/^disallow:\s*(\S*)$/i);
      if (dis && inOurGroup && dis[1]) r.disallow.push(dis[1]);
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
      return Robots.parse(await res.text());
    } catch {
      return new Robots(); // unreachable robots file: proceed, delays still apply
    }
  }

  allows(url: string): boolean {
    const path = new URL(url).pathname;
    return !this.disallow.some((d) => path.startsWith(d));
  }
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
  onProgress?: (source: string, fetched: number, queued: number) => void;
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
  const queue: string[] = [seed];
  let fetched = 0;
  let lastStart = 0;

  async function fetchOne(url: string): Promise<void> {
    const wait = Math.max(0, lastStart + delayMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();

    let html: string | null = null;
    let finalUrl = url;
    // One retry on a transient failure: a single dropped seed fetch would
    // otherwise silently zero out a whole source.
    for (let attempt = 0; attempt < 2 && html === null; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(20000),
          redirect: "follow",
        });
        if (!res.ok) return;
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("text/html")) return;
        const body = await res.text();
        if (body.length > 3_000_000) return;
        html = body;
        finalUrl = res.url || url;
      } catch {
        if (attempt === 1) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (html === null) return;

    // Links resolve against the FINAL url (after redirects, trailing slash
    // intact) — resolving "assert.html" against the normalised ".../api"
    // would drop the last segment and leave the docs tree entirely.
    const { title, headings, text, links } = extractPage(html, finalUrl);
    if (text.length < 200) return; // a stub or redirect shell, not a document
    fetched++;
    // On a resumed run, pages already stored are traversed for their links
    // but not stored twice.
    if (!hooks.alreadyHave?.has(url)) {
      hooks.onPage?.({ url, source: source.name, title, headings, text });
    }
    hooks.onProgress?.(source.name, fetched, queue.length);

    for (const link of links) {
      const n = normalizeUrl(link);
      if (!n || seen.has(n)) continue;
      if (!n.startsWith(source.allowedPrefix)) continue;
      if (SKIP_EXT.test(new URL(n).pathname)) continue;
      seen.add(n);
      if (!hooks.alreadyHave?.has(n)) queue.push(n);
      else queue.push(n); // still traverse through it to reach deeper pages
    }
  }

  // Small worker pool sharing the queue; the per-host start delay above is
  // enforced across all workers, so politeness holds under concurrency.
  async function worker(): Promise<void> {
    while (queue.length > 0 && fetched < source.maxPages) {
      const url = queue.shift()!;
      if (hooks.alreadyHave?.has(url)) {
        // already stored from a previous run: still expand its links cheaply
        // by fetching — correctness of coverage beats saving one request.
      }
      if (!robots.allows(url)) continue;
      await fetchOne(url);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return fetched;
}
