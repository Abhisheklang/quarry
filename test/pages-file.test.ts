import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPagesJsonl } from "../src/pages-file.ts";

test("readPagesJsonl parses stored pages and skips blank and torn lines (V4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "quarry-pages-test-"));
  const file = join(dir, "pages.jsonl");
  const page = (url: string) =>
    JSON.stringify({ url, source: "test", title: "T", headings: "", text: "body" });
  writeFileSync(
    file,
    [page("https://example.com/a"), "", page("https://example.com/b"), '{"url":"https://exa'].join("\n"),
  );
  const pages = readPagesJsonl(file);
  assert.deepEqual(
    pages.map((p) => p.url),
    ["https://example.com/a", "https://example.com/b"],
  );
});

test("readPagesJsonl skips wrong-shape lines and reports their line numbers (K10)", () => {
  const dir = mkdtempSync(join(tmpdir(), "quarry-pages-test-"));
  const file = join(dir, "pages.jsonl");
  const good = JSON.stringify({
    url: "https://example.com/a",
    source: "test",
    title: "T",
    headings: "",
    text: "body",
  });
  writeFileSync(
    file,
    [
      good, // line 1: the only valid page
      '{"url":"http://example.com/b","source":"S"}', // line 2: missing fields
      "42", // line 3
      '"just a string"', // line 4
      "null", // line 5
    ].join("\n"),
  );
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  let pages;
  try {
    pages = readPagesJsonl(file);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(
    pages.map((p) => p.url),
    ["https://example.com/a"],
  );
  assert.equal(errors.length, 4);
  for (const n of [2, 3, 4, 5]) {
    assert.ok(
      errors.some((e) => e.includes(`line ${n}:`)),
      `expected a warning naming line ${n}, got: ${errors.join(" | ")}`,
    );
  }
});
