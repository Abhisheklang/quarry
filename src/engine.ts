// The Quarry engine: inverted index with positions + BM25 ranking +
// snippet generation. Hand-written — no search libraries.
import { tokenize } from "./text.ts";
import type { CrawledPage } from "./crawler.ts";

export interface IndexedDoc {
  url: string;
  source: string;
  title: string;
  text: string;
  len: number; // token count of the indexed stream
}

export interface Index {
  version: number;
  builtAt: string;
  docs: IndexedDoc[];
  // term -> list of [docId, positions[]]
  postings: Record<string, [number, number[]][]>;
  avgLen: number;
  sources: Record<string, number>; // source name -> doc count
}

const K1 = 1.2;
const B = 0.75;

// Boilerplate cut, applied at index time: documentation templates append
// community/footer blocks inside <main> (MDN's "Help improve MDN" panel is
// the big one — it put "contributor" in 98% of pages). A marker only cuts
// when it appears in the latter half of the page, so a page genuinely about
// contributing is not truncated.
const BOILERPLATE_MARKERS = [
  "help improve mdn",
  "was this page helpful",
  "this page was last modified",
];

export function stripBoilerplate(text: string): string {
  const lower = text.toLowerCase();
  let cut = text.length;
  for (const marker of BOILERPLATE_MARKERS) {
    const at = lower.indexOf(marker);
    if (at > text.length * 0.5 && at < cut) cut = at;
  }
  return text.slice(0, cut).trimEnd();
}

export function buildIndex(pages: CrawledPage[]): Index {
  const docs: IndexedDoc[] = [];
  // A Map, not a plain object: documentation text contains terms like
  // "constructor" and "__proto__" that collide with Object.prototype.
  const postingsMap = new Map<string, [number, number[]][]>();
  const sources: Record<string, number> = {};
  let totalLen = 0;

  pages.forEach((page, docId) => {
    const text = stripBoilerplate(page.text);
    // Field weighting by repetition: title tokens count three times,
    // heading tokens twice, body tokens once. Crude, effective, and easy
    // to explain — a match where it matters most wins.
    const cleanTitle = page.title.replace(/\s*[|\-–—]\s*(MDN|React|Node\.js|TypeScript).*$/i, "");
    const stream = [
      ...tokenize(cleanTitle),
      ...tokenize(cleanTitle),
      ...tokenize(cleanTitle),
      ...tokenize(page.headings),
      ...tokenize(page.headings),
      ...tokenize(text),
    ];

    const positions = new Map<string, number[]>();
    stream.forEach((term, i) => {
      const arr = positions.get(term);
      if (arr) arr.push(i);
      else positions.set(term, [i]);
    });
    for (const [term, pos] of positions) {
      const arr = postingsMap.get(term);
      if (arr) arr.push([docId, pos]);
      else postingsMap.set(term, [[docId, pos]]);
    }
    docs.push({
      url: page.url,
      source: page.source,
      title: page.title,
      text,
      len: stream.length,
    });
    sources[page.source] = (sources[page.source] ?? 0) + 1;
    totalLen += stream.length;
  });

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    docs,
    postings: Object.fromEntries(postingsMap),
    avgLen: docs.length ? totalLen / docs.length : 0,
    sources,
  };
}

export interface Result {
  url: string;
  source: string;
  title: string;
  score: number;
  snippet: string;
}

export interface SearchOutcome {
  total: number;
  timeMs: number;
  results: Result[];
}

function makeSnippet(doc: IndexedDoc, queryTerms: string[]): string {
  const lower = doc.text.toLowerCase();
  let at = -1;
  for (const term of queryTerms) {
    const re = new RegExp(`[a-z0-9]*${term}[a-z0-9]*`, "i");
    const m = lower.match(re);
    if (m && m.index !== undefined) {
      at = m.index;
      break;
    }
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - 70);
  const end = Math.min(doc.text.length, at + 140);
  let snippet = doc.text.slice(start, end).trim();
  // Neutralize ** pairs that are literally in the page text (markdown
  // documentation is full of them): a zero-width space between the two
  // asterisks keeps them from pairing up with the genuine match markers
  // added below and rendering as highlights.
  snippet = snippet.replace(/\*\*/g, "*\u200b*");
  for (const term of queryTerms) {
    snippet = snippet.replace(
      new RegExp(`([a-z0-9]*${term}[a-z0-9]*)`, "gi"),
      "**$1**",
    );
  }
  return (start > 0 ? "…" : "") + snippet + (end < doc.text.length ? "…" : "");
}

export function search(
  index: Index,
  query: string,
  opts: { limit?: number; offset?: number; source?: string | undefined } = {},
): SearchOutcome {
  const started = performance.now();
  const limit = opts.limit ?? 10;
  const offset = Math.max(0, opts.offset ?? 0);
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) {
    return { total: 0, timeMs: 0, results: [] };
  }
  const n = index.docs.length;
  const scores = new Map<number, number>();

  for (const term of terms) {
    // hasOwn guard: a query term like "toString" must not pick up
    // Object.prototype members when it is absent from the index.
    const posting = Object.hasOwn(index.postings, term)
      ? index.postings[term]
      : undefined;
    if (!posting) continue;
    const df = posting.length;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (const [docId, positions] of posting) {
      const doc = index.docs[docId];
      if (!doc) continue;
      if (opts.source && doc.source !== opts.source) continue;
      const tf = positions.length;
      const dl = doc.len;
      const denom = tf + K1 * (1 - B + (B * dl) / index.avgLen);
      scores.set(docId, (scores.get(docId) ?? 0) + idf * ((tf * (K1 + 1)) / denom));
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const results = ranked.slice(offset, offset + limit).flatMap(([docId, score]) => {
    const doc = index.docs[docId];
    if (!doc) return [];
    return [
      {
        url: doc.url,
        source: doc.source,
        title: doc.title,
        score: Number(score.toFixed(3)),
        snippet: makeSnippet(doc, terms),
      },
    ];
  });
  return {
    total: ranked.length,
    timeMs: Number((performance.now() - started).toFixed(2)),
    results,
  };
}

export interface IndexStats {
  documents: number;
  terms: number;
  avgDocLength: number;
  sources: Record<string, number>;
  builtAt: string;
  topTerms: { term: string; documents: number }[];
}

export function stats(index: Index): IndexStats {
  const topTerms = Object.entries(index.postings)
    .map(([term, posting]) => ({ term, documents: posting.length }))
    .sort((a, b) => b.documents - a.documents)
    .slice(0, 25);
  return {
    documents: index.docs.length,
    terms: Object.keys(index.postings).length,
    avgDocLength: Math.round(index.avgLen),
    sources: index.sources,
    builtAt: index.builtAt,
    topTerms,
  };
}
