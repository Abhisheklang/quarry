// Build-index CLI: reads data/pages.jsonl and writes data/index.json.
//
//   node src/build-index.ts
import { writeFileSync } from "node:fs";
import { buildIndex, stats } from "./engine.ts";
import { readPagesJsonl } from "./pages-file.ts";
import type { CrawledPage } from "./crawler.ts";

const IN = new URL("../data/pages.jsonl", import.meta.url).pathname;
const OUT = new URL("../data/index.json", import.meta.url).pathname;

const seen = new Set<string>();
const pages: CrawledPage[] = [];
for (const page of readPagesJsonl(IN)) {
  if (seen.has(page.url)) continue;
  seen.add(page.url);
  pages.push(page);
}

const started = Date.now();
const index = buildIndex(pages);
writeFileSync(OUT, JSON.stringify(index));
const s = stats(index);
console.log(
  `indexed ${s.documents} docs | ${s.terms} terms | avg length ${s.avgDocLength} tokens | ` +
    `sources ${JSON.stringify(s.sources)} | built in ${Date.now() - started}ms -> ${OUT}`,
);
