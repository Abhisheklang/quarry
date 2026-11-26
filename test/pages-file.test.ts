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
