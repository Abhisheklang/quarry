// Shared reader for data/pages.jsonl, the crawler's output file: one
// JSON page per line. Used by both the crawl CLI (resume set) and the
// index builder (dedupe), which previously each carried their own copy
// of this loop and had already drifted apart.
import { readFileSync } from "node:fs";
import type { CrawledPage } from "./crawler.ts";

// A line counts as a page only when it parses to an object whose five
// fields are all strings (K10). Valid JSON of the wrong shape - a
// missing field, a bare number, a string, null - used to flow through
// unchecked and crash both consumers later with a bare TypeError that
// named neither the line nor the file.
function isCrawledPage(value: unknown): value is CrawledPage {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.url === "string" &&
    typeof p.source === "string" &&
    typeof p.title === "string" &&
    typeof p.headings === "string" &&
    typeof p.text === "string"
  );
}

export function readPagesJsonl(path: string): CrawledPage[] {
  const pages: CrawledPage[] = [];
  const lines = readFileSync(path, "utf-8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // torn last line from an interrupted crawl — skip it
      continue;
    }
    if (!isCrawledPage(parsed)) {
      console.error(
        `${path}: line ${i + 1}: skipping malformed page entry (expected an object with string url, source, title, headings and text)`,
      );
      continue;
    }
    pages.push(parsed);
  }
  return pages;
}
