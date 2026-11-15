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

test("normalizeUrl strips fragments and tracking params", () => {
  assert.equal(
    normalizeUrl("https://Example.com/docs/page?utm_source=x#section"),
    "https://example.com/docs/page",
  );
  assert.equal(normalizeUrl("ftp://example.com/file"), null);
  assert.equal(normalizeUrl("not a url"), null);
});
