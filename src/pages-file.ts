// Shared reader for data/pages.jsonl, the crawler's output file: one
// JSON page per line. Used by both the crawl CLI (resume set) and the
// index builder (dedupe), which previously each carried their own copy
// of this loop and had already drifted apart.
import { readFileSync } from "node:fs";
import type { CrawledPage } from "./crawler.ts";

export function readPagesJsonl(path: string): CrawledPage[] {
  const pages: CrawledPage[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      pages.push(JSON.parse(line) as CrawledPage);
    } catch {
      // torn last line from an interrupted crawl — skip it
    }
  }
  return pages;
}
