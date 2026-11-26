import { test } from "node:test";
import assert from "node:assert/strict";
import { Robots, normalizeUrl } from "../src/crawler.ts";

const ROBOTS = `
User-agent: *
Disallow: /api/
Disallow: /*/files/

User-agent: BadBot
Disallow: /
`;

test("robots: star-group disallows are enforced by prefix", () => {
  const r = Robots.parse(ROBOTS);
  assert.equal(r.allows("https://example.com/docs/page"), true);
  assert.equal(r.allows("https://example.com/api/search"), false);
});

test("robots: another agent's blanket ban does not apply to us", () => {
  const r = Robots.parse(ROBOTS);
  assert.equal(r.allows("https://example.com/anything"), true);
});

test("robots: shared rules in a multi-agent group apply to us", () => {
  const body = `
User-agent: *
User-agent: BadBot
Disallow: /private/
`;
  const r = Robots.parse(body);
  assert.equal(r.allows("https://example.com/private/page"), false);
  assert.equal(r.allows("https://example.com/docs/page"), true);
});

test("robots: a user-agent line after rules starts a new group", () => {
  const body = `
User-agent: BadBot
Disallow: /private/
User-agent: *
Disallow: /api/
`;
  const r = Robots.parse(body);
  assert.equal(r.allows("https://example.com/private/page"), true);
  assert.equal(r.allows("https://example.com/api/search"), false);
});

test("robots: wildcard Disallow rules are enforced (SEC2)", () => {
  const r = Robots.parse(ROBOTS); // the fixture contains Disallow: /*/files/
  assert.equal(r.allows("https://example.com/docs/files/x"), false);
  assert.equal(r.allows("https://example.com/docs/page"), true);
  const pdf = Robots.parse("User-agent: *\nDisallow: /tmp/*.pdf\n");
  assert.equal(pdf.allows("https://example.com/tmp/a.pdf"), false);
  assert.equal(pdf.allows("https://example.com/tmp/a.html"), true);
});

test("robots: a Disallow line with a trailing comment still applies (SEC3)", () => {
  const r = Robots.parse("User-agent: *\nDisallow: /private/ # keep out\n");
  assert.equal(r.allows("https://example.com/private/x"), false);
  assert.equal(r.allows("https://example.com/docs/page"), true);
});

test("robots: Allow rules reopen a subtree of a Disallow (K8)", () => {
  const r = Robots.parse("User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\n");
  assert.equal(r.allows("https://example.com/docs/public/x"), true);
  assert.equal(r.allows("https://example.com/docs/private/x"), false);
});

test("robots: an own-agent group governs over the star group (Q-ADV-2)", () => {
  const body = `
User-agent: quarrybot
Disallow: /private/

User-agent: *
Allow: /private/
`;
  const r = Robots.parse(body);
  assert.equal(r.allows("https://example.com/private/x"), false);
  assert.equal(r.allows("https://example.com/docs/page"), true);
});

test("robots: a longer star-group Allow cannot override an own-group Disallow (Q-ADV-2)", () => {
  const body = `
User-agent: *
Allow: /private/public/

User-agent: QuarryBot
Disallow: /private/
`;
  const r = Robots.parse(body);
  assert.equal(r.allows("https://example.com/private/public/x"), false);
});

test("robots: star-group rules do not leak into paths the own group leaves open (Q-ADV-2)", () => {
  const body = `
User-agent: quarrybot
Disallow: /a/

User-agent: *
Disallow: /b/
`;
  const r = Robots.parse(body);
  assert.equal(r.allows("https://example.com/a/x"), false);
  // The own group governs, so the star group's /b/ ban does not apply.
  assert.equal(r.allows("https://example.com/b/x"), true);
});

test("robots: a shared group naming our agent counts as an own group (Q-ADV-2)", () => {
  const body = `
User-agent: OtherBot
User-agent: quarrybot
Disallow: /private/

User-agent: *
Allow: /private/
`;
  const r = Robots.parse(body);
  assert.equal(r.allows("https://example.com/private/x"), false);
});

test("robots: a 5xx robots.txt means complete disallow (Q-ADV-3)", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [500, 503, 599]) {
      globalThis.fetch = async () => new Response("server error", { status });
      const r = await Robots.load("https://example.com");
      assert.equal(r.allows("https://example.com/anything"), false, `status ${status}`);
      assert.equal(r.allows("https://example.com/"), false, `status ${status}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("robots: an unreachable robots.txt means complete disallow (Q-ADV-3)", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const r = await Robots.load("https://example.com");
    assert.equal(r.allows("https://example.com/anything"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("robots: a 4xx robots.txt still means everything allowed (Q-ADV-3)", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("not found", { status: 404 });
    const r = await Robots.load("https://example.com");
    assert.equal(r.allows("https://example.com/anything"), true);
    // A healthy 200 robots.txt is still parsed normally.
    globalThis.fetch = async () =>
      new Response("User-agent: *\nDisallow: /private/\n", { status: 200 });
    const parsed = await Robots.load("https://example.com");
    assert.equal(parsed.allows("https://example.com/private/x"), false);
    assert.equal(parsed.allows("https://example.com/docs/page"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizeUrl strips fragments and tracking params", () => {
  assert.equal(
    normalizeUrl("https://Example.com/docs/page?utm_source=x#section"),
    "https://example.com/docs/page",
  );
  assert.equal(normalizeUrl("ftp://example.com/file"), null);
  assert.equal(normalizeUrl("not a url"), null);
});
