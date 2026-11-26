// Crawl CLI: fetches the frozen allowlist of documentation sources and
// appends pages to data/pages.jsonl (one JSON page per line, so an
// interrupted crawl keeps what it already collected).
//
//   node src/crawl.ts <sourceName ...>   crawl the named live sources
//   node src/crawl.ts --live             crawl all live sources
//   node src/crawl.ts --dry-run [names]  list the selected sources, fetch nothing
//   node src/crawl.ts --help             show this usage
//
// A bare run used to crawl every live source by default (R9): live
// crawling now always takes an explicit selection, either source names
// or --live.
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

export interface CliSelection {
  sources: Source[];
  dryRun: boolean;
  help: boolean;
}

// Parse the CLI arguments into a selection. Pure, so the argument rules
// are testable without spawning a crawl. Throws an Error whose message
// is shown to the user (exit 1) for an unknown source name (the V7
// check), an unknown flag, --live combined with names, or no selection
// at all (R9: a bare run must not default to the live corpus).
export function parseArgs(argv: string[]): CliSelection {
  const names: string[] = [];
  let live = false;
  let dryRun = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--live") live = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("-")) throw new Error(`unknown flag: ${arg}`);
    else names.push(arg);
  }
  if (help) return { sources: [], dryRun, help };
  const unknown = names.filter((name) => !SOURCES.some((s) => s.name === name));
  if (unknown.length) {
    throw new Error(
      `unknown source name(s): ${unknown.join(", ")}. Known sources: ${SOURCES.map((s) => s.name).join(", ")}`,
    );
  }
  if (live && names.length) {
    throw new Error("--live selects all sources; do not combine it with source names");
  }
  if (!live && !names.length && !dryRun) {
    throw new Error(
      "no sources selected: name the sources to crawl, or pass --live for all of them (see --help)",
    );
  }
  const sources = live || !names.length
    ? SOURCES
    : SOURCES.filter((s) => names.includes(s.name));
  return { sources, dryRun, help };
}

export function usage(): string {
  return [
    "Usage:",
    "  node src/crawl.ts <sourceName ...>   crawl the named live sources",
    "  node src/crawl.ts --live             crawl all live sources",
    "  node src/crawl.ts --dry-run [names]  list the selected sources, fetch nothing",
    "  node src/crawl.ts --help             show this usage",
    "",
    `Known sources: ${SOURCES.map((s) => s.name).join(", ")}`,
    "Live crawling always takes an explicit selection: a bare run fetches nothing.",
  ].join("\n");
}

async function main(): Promise<void> {
  let selection: CliSelection;
  try {
    selection = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  if (selection.help) {
    console.log(usage());
    return;
  }
  if (selection.dryRun) {
    console.log("dry run: no pages will be fetched");
    for (const s of selection.sources) {
      console.log(`  ${s.name}: seed ${s.seed} (cap ${s.maxPages})`);
    }
    return;
  }
  const sources = selection.sources;

  mkdirSync(new URL("../data", import.meta.url).pathname, { recursive: true });
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

// Run only as the CLI entry point, so tests can import parseArgs and
// SOURCES without starting a crawl.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
