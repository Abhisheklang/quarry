import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, search, stats } from "../src/engine.ts";
import type { CrawledPage } from "../src/crawler.ts";

function page(url: string, source: string, title: string, text: string): CrawledPage {
  return { url, source, title, headings: title, text };
}

const corpus: CrawledPage[] = [
  page(
    "https://docs.example/promise",
    "MDN",
    "Promise",
    "A promise represents the eventual completion of an asynchronous operation. " +
      "Promises chain with then and catch. A promise can be pending, fulfilled or rejected.",
  ),
  page(
    "https://docs.example/arrays",
    "MDN",
    "Array",
    "An array is a list-like object. Arrays have methods like map, filter and reduce " +
      "for transforming collections of values.",
  ),
  page(
    "https://docs.example/cooking",
    "Node.js",
    "Dinner notes",
    "Boil the pasta in salted water. A promise to serve dinner at eight was made " +
      "to the guests, with arrays of cutlery on the table.",
  ),
];

const index = buildIndex(corpus);

test("search ranks the on-topic page first", () => {
  const out = search(index, "how do promises work");
  assert.ok(out.results.length >= 2);
  assert.equal(out.results[0].url, "https://docs.example/promise");
});

test("a title match beats a passing body mention", () => {
  const out = search(index, "array");
  assert.equal(out.results[0].url, "https://docs.example/arrays");
});

test("snippets highlight the matched terms", () => {
  const out = search(index, "promise");
  assert.ok(out.results[0].snippet.includes("**"));
});

test("source filter restricts results", () => {
  const out = search(index, "promise", { source: "Node.js" });
  assert.ok(out.results.every((r) => r.source === "Node.js"));
});

test("stats report the corpus honestly", () => {
  const s = stats(index);
  assert.equal(s.documents, 3);
  assert.equal(s.sources["MDN"], 2);
  assert.ok(s.terms > 10);
});

test("terms colliding with Object.prototype are indexed and searchable", () => {
  const tricky = buildIndex([
    page(
      "https://docs.example/ctor",
      "MDN",
      "constructor",
      "The constructor method is a special method of a class for creating " +
        "and initializing an object instance of that class.",
    ),
    ...corpus,
  ]);
  const out = search(tricky, "constructor");
  assert.equal(out.results[0].url, "https://docs.example/ctor");
  // a prototype name that is NOT in the index must not explode the search
  const none = search(tricky, "hasOwnProperty");
  assert.ok(Array.isArray(none.results));
});

test("a query with no corpus match returns nothing, not an invention", () => {
  const out = search(index, "quantum chromodynamics");
  assert.equal(out.total, 0);
});
