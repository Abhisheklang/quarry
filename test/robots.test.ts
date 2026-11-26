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

test("normalizeUrl strips fragments and tracking params", () => {
  assert.equal(
    normalizeUrl("https://Example.com/docs/page?utm_source=x#section"),
    "https://example.com/docs/page",
  );
  assert.equal(normalizeUrl("ftp://example.com/file"), null);
  assert.equal(normalizeUrl("not a url"), null);
});
