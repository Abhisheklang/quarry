import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseArgs, SOURCES } from "../src/crawl.ts";

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["src/crawl.ts", ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf-8",
    timeout: 30000,
  });
}

test("crawl CLI exits nonzero and names the problem for an unknown source (V7)", () => {
  const result = runCli(["NoSuchSource"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("NoSuchSource"), `stderr should name the bad source: ${result.stderr}`);
  assert.ok(result.stderr.includes("MDN"), `stderr should list the known sources: ${result.stderr}`);
});

test("crawl CLI refuses a bare run instead of defaulting to all live sources (R9)", () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.ok(
    result.stderr.includes("no sources selected"),
    `stderr should explain the missing selection: ${result.stderr}`,
  );
});

test("crawl CLI accepts --dry-run and --help (R9)", () => {
  const dry = runCli(["--dry-run"]);
  assert.equal(dry.status, 0);
  assert.ok(dry.stdout.includes("no pages will be fetched"), `dry-run output: ${dry.stdout}`);
  assert.ok(dry.stdout.includes("MDN"), `dry-run should list the sources: ${dry.stdout}`);

  const dryOne = runCli(["--dry-run", "MDN"]);
  assert.equal(dryOne.status, 0);
  assert.ok(dryOne.stdout.includes("MDN"), `dry-run output: ${dryOne.stdout}`);
  assert.ok(!dryOne.stdout.includes("React"), `dry-run with one name lists only it: ${dryOne.stdout}`);

  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes("--live"), `help output: ${help.stdout}`);
});

test("parseArgs selection rules (R9, V7)", () => {
  assert.deepEqual(
    parseArgs(["MDN", "React"]).sources.map((s) => s.name),
    ["MDN", "React"],
  );
  assert.equal(parseArgs(["--live"]).sources.length, SOURCES.length);
  assert.equal(parseArgs(["--dry-run"]).sources.length, SOURCES.length);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs([]), /no sources selected/);
  assert.throws(() => parseArgs(["NoSuchSource"]), /unknown source name\(s\): NoSuchSource/);
  assert.throws(() => parseArgs(["--live", "MDN"]), /do not combine/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown flag: --bogus/);
});
