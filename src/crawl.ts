// Crawl CLI: fetches the frozen allowlist of documentation sources and
// appends pages to data/pages.jsonl (one JSON page per line, so an
// interrupted crawl keeps what it already collected).
//
//   node src/crawl.ts [sourceName ...]   (default: all sources)
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { crawlSource, type Source } from "./crawler.ts";
import { readPagesJsonl } from "./pages-file.ts";

// The frozen corpus (decided 2026-11-16): developer documentation only.
export const SOURCES: Source[] = [
  {
    name: "MDN",
    seed: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
    allowedPrefix: "https://developer.mozilla.org/en-US/docs/Web",
    maxPages: 3500,
  },
  {
    name: "Node.js",
    seed: "https://nodejs.org/api/",
    allowedPrefix: "https://nodejs.org/api/",
    maxPages: 200,
  },
  {
    name: "TypeScript",
    seed: "https://www.typescriptlang.org/docs/",
    allowedPrefix: "https://www.typescriptlang.org/docs/",
    maxPages: 700,
  },
  {
    name: "React",
    seed: "https://react.dev/learn",
    allowedPrefix: "https://react.dev/",
    maxPages: 500,
  },
];

const OUT = new URL("../data/pages.jsonl", import.meta.url).pathname;

async function main(): Promise<void> {
  mkdirSync(new URL("../data", import.meta.url).pathname, { recursive: true });
  const only = process.argv.slice(2);
  const sources = only.length
    ? SOURCES.filter((s) => only.includes(s.name))
    : SOURCES;

  const alreadyHave = new Set<string>();
  if (existsSync(OUT)) {
    for (const page of readPagesJsonl(OUT)) alreadyHave.add(page.url);
    console.log(`resume: ${alreadyHave.size} pages already stored`);
  }

  const started = Date.now();
  let stored = 0;
  for (const source of sources) {
    console.log(`\n== ${source.name} (cap ${source.maxPages}) ==`);
    const n = await crawlSource(source, {
      alreadyHave,
      onPage: (page) => {
        appendFileSync(OUT, JSON.stringify(page) + "\n");
        stored++;
      },
      onProgress: (name, fetched, queued) => {
        if (fetched % 50 === 0) {
          console.log(`  ${name}: ${fetched} fetched, ${queued} queued`);
        }
      },
    });
    console.log(`== ${source.name}: ${n} pages fetched ==`);
  }
  console.log(
    `\ndone: ${stored} new pages stored in ${((Date.now() - started) / 60000).toFixed(1)} min -> ${OUT}`,
  );
}

await main();
