import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("crawl CLI exits nonzero and names the problem for an unknown source (V7)", () => {
  const result = spawnSync(process.execPath, ["src/crawl.ts", "NoSuchSource"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf-8",
    timeout: 30000,
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("NoSuchSource"), `stderr should name the bad source: ${result.stderr}`);
  assert.ok(result.stderr.includes("MDN"), `stderr should list the known sources: ${result.stderr}`);
});
