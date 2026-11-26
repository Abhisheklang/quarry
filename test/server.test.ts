import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Self-contained minimal index: data/index.json is gitignored, so CI has
// no index on disk. The server only needs a structurally valid one.
const INDEX_DIR = mkdtempSync(join(tmpdir(), "quarry-server-test-"));
const INDEX = join(INDEX_DIR, "index.json");
writeFileSync(
  INDEX,
  JSON.stringify({
    version: 1,
    builtAt: new Date().toISOString(),
    docs: [
      {
        url: "https://example.com/docs/promise",
        source: "test",
        title: "Promises",
        text: "A promise represents an asynchronous operation.",
        len: 6,
      },
    ],
    postings: { promis: [[0, [0]]] }, // queries stem "promise" to "promis"
    avgLen: 6,
    sources: { test: 1 },
  }),
);

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), QUARRY_INDEX: INDEX },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("server did not start");
}

const HEADERS_PORT = 3417;
const BURST_PORT = 3418;
let headersServer: ChildProcess;
let burstServer: ChildProcess;

before(async () => {
  headersServer = await startServer(HEADERS_PORT);
  burstServer = await startServer(BURST_PORT);
});
after(() => {
  headersServer?.kill();
  burstServer?.kill();
});

function assertSecurityHeaders(res: Response) {
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.ok(csp.includes("default-src 'self'"), `CSP missing default-src: ${csp}`);
  assert.ok(csp.includes("frame-ancestors 'none'"), `CSP missing frame-ancestors: ${csp}`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "same-origin");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
}

for (const path of ["/", "/search?q=promise", "/dashboard", "/api/search?q=promise", "/api/stats", "/health"]) {
  test(`security headers present on ${path}`, async () => {
    const res = await fetch(`http://127.0.0.1:${HEADERS_PORT}${path}`);
    assert.equal(res.status, 200);
    assertSecurityHeaders(res);
    await res.text();
  });
}

test("/api/search honours the offset parameter (U1)", async () => {
  const first = await fetch(`http://127.0.0.1:${HEADERS_PORT}/api/search?q=promise&limit=1&offset=0`);
  const firstBody = JSON.parse(await first.text());
  assert.equal(firstBody.total, 1);
  assert.equal(firstBody.results.length, 1);
  const past = await fetch(`http://127.0.0.1:${HEADERS_PORT}/api/search?q=promise&limit=1&offset=1`);
  const pastBody = JSON.parse(await past.text());
  assert.equal(pastBody.total, 1);
  assert.equal(pastBody.results.length, 0);
});

test("pages ship a dark color scheme driven by CSS variables (U2)", async () => {
  const res = await fetch(`http://127.0.0.1:${HEADERS_PORT}/`);
  const html = await res.text();
  assert.ok(html.includes("@media (prefers-color-scheme:dark)"), "dark scheme block missing");
  assert.ok(html.includes("--link:"), "result link color must come from a variable");
  assert.ok(!html.includes(".result h3 a{color:#1e3a8a"), "hardcoded light link color still present");
  assert.ok(!html.includes(".result p{margin:0;color:#44403c"), "hardcoded light snippet color still present");
});

test("asset routes serve the exact asset bytes (R6)", async () => {
  const res = await fetch(`http://127.0.0.1:${HEADERS_PORT}/assets/logo.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  const served = Buffer.from(await res.arrayBuffer());
  const onDisk = readFileSync(new URL("../assets/logo.png", import.meta.url).pathname);
  assert.ok(served.equals(onDisk), "served logo must equal the file on disk");
});

test("/api/stats returns indexSizeMb as a number (K7)", async () => {
  const res = await fetch(`http://127.0.0.1:${HEADERS_PORT}/api/stats`);
  const body = JSON.parse(await res.text());
  assert.equal(typeof body.indexSizeMb, "number");
  assert.equal(typeof body.documents, "number");
});

test("non-GET methods are rejected with 405 (SEC4)", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await fetch(`http://127.0.0.1:${HEADERS_PORT}/`, { method });
    assert.equal(res.status, 405, `${method} / should be 405`);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
    await res.text();
  }
  const head = await fetch(`http://127.0.0.1:${HEADERS_PORT}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
});

test("security headers present on a 404 response", async () => {
  const res = await fetch(`http://127.0.0.1:${HEADERS_PORT}/no-such-page`);
  assert.equal(res.status, 404);
  assertSecurityHeaders(res);
  await res.text();
});

test("an invalid PORT exits with a clear message instead of a NaN banner (K9)", () => {
  const result = spawnSync(process.execPath, ["src/server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: "abc", QUARRY_INDEX: INDEX },
    encoding: "utf-8",
    timeout: 30000,
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('Invalid PORT "abc"'), `stderr: ${result.stderr}`);
  assert.ok(!result.stderr.includes("NaN"), `stderr must not claim a NaN port: ${result.stderr}`);
});

test("normal-rate API requests pass and a burst beyond the limit gets 429", async () => {
  // Normal rate: a handful of requests all succeed.
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`http://127.0.0.1:${BURST_PORT}/api/search?q=promise`);
    assert.equal(res.status, 200);
    await res.text();
  }
  // Burst: 120 rapid requests (the S1 probe shape). The limit is 60 per
  // minute per IP, so the burst must produce both 200s and 429s.
  const statuses: number[] = [];
  await Promise.all(
    Array.from({ length: 120 }, async () => {
      const res = await fetch(`http://127.0.0.1:${BURST_PORT}/api/search?q=promise`);
      statuses.push(res.status);
      await res.text();
    }),
  );
  const ok = statuses.filter((s) => s === 200).length;
  const throttled = statuses.filter((s) => s === 429).length;
  assert.ok(ok > 0, `expected some 200s, got ${ok}`);
  assert.ok(throttled > 0, `expected some 429s, got ${throttled}`);
  assert.equal(ok + throttled, 120);
  // 5 normal + burst successes cannot exceed the 60 per minute limit.
  assert.ok(ok <= 55, `expected at most 55 burst 200s after 5 normal requests, got ${ok}`);
});
