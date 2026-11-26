import { test } from "node:test";
import assert from "node:assert/strict";
import { stem, tokenize, extractPage, decodeEntities } from "../src/text.ts";

test("stem merges common inflections of the same word", () => {
  assert.equal(stem("promises"), stem("promise"));
  assert.equal(stem("promising"), stem("promise"));
  assert.equal(stem("arrays"), stem("array"));
  assert.equal(stem("running"), "run");
});

test("tokenize lowercases, stems and drops stopwords", () => {
  const tokens = tokenize("How do Promises work in JavaScript?");
  assert.ok(tokens.includes("promis"));
  assert.ok(tokens.includes("javascript"));
  assert.ok(!tokens.includes("how"));
  assert.ok(!tokens.includes("do"));
});

test("tokenize keeps C++ and C# as searchable terms (K3)", () => {
  assert.ok(tokenize("C++").includes("cpp"));
  assert.ok(tokenize("C#").includes("csharp"));
  assert.ok(tokenize("How does C++ work").includes("cpp"));
  assert.ok(tokenize("C# generics").includes("csharp"));
});

test("extractPage finds unquoted hrefs (Node.js docs style)", () => {
  const html = `<html><head><title>Index</title></head><body><main>
  <a class=nav-assert href=assert.html>Assertion testing</a>
  <a href='single.html'>Single quoted</a>
  <p>${"Documentation text that is comfortably over the stub threshold. ".repeat(6)}</p>
  </main></body></html>`;
  const page = extractPage(html, "https://nodejs.org/api/");
  assert.ok(page.links.some((l) => l === "https://nodejs.org/api/assert.html"));
  assert.ok(page.links.some((l) => l === "https://nodejs.org/api/single.html"));
});

test("decodeEntities leaves out-of-range code points untouched instead of throwing", () => {
  assert.equal(decodeEntities("a &#1114112; b"), "a &#1114112; b");
  assert.equal(decodeEntities("a &#x110000; b"), "a &#x110000; b");
  assert.equal(decodeEntities("a &#999999999; b"), "a &#999999999; b");
  // Valid entities still decode, including the maximum valid code point.
  assert.equal(decodeEntities("&#65;&#x42;"), "AB");
  assert.equal(decodeEntities("&#1114111;"), String.fromCodePoint(0x10ffff));
});

test("decodeEntities decodes common named entities (K4)", () => {
  assert.equal(
    decodeEntities("Tom &amp; Jerry &mdash; &copy; 2026 &rsquo;til &hellip;"),
    "Tom & Jerry — © 2026 ’til …",
  );
  assert.equal(decodeEntities("&ldquo;quoted&rdquo; &ndash; &trade;"), "“quoted” – ™");
});

test("decodeEntities never double-decodes (K5)", () => {
  assert.equal(decodeEntities("&#38;lt; should stay literal &lt;"), "&lt; should stay literal <");
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeEntities("&#38;#60;"), "&#60;");
});

test("extractPage survives a page containing an out-of-range entity", () => {
  const html = `<html><head><title>Bad entity</title></head><body><main>
  <p>Broken entity &#1114112; and hex &#x110000; in otherwise normal text. ${"Documentation text that is comfortably over the stub threshold. ".repeat(6)}</p>
  </main></body></html>`;
  const page = extractPage(html, "https://example.com/docs/page");
  assert.ok(page.text.includes("otherwise normal text"));
});

test("extractPage pulls title, main text, headings and links", () => {
  const html = `<!doctype html><html><head><title>Promise | MDN</title></head>
  <body><nav>navigation junk that should mostly be ignored</nav>
  <main><h1>Promise</h1><p>A Promise is an object representing the eventual
  completion or failure of an asynchronous operation and its resulting value.
  This page explains how promises work in practice, with examples.</p>
  <a href="/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all">Promise.all</a>
  </main><footer>footer text</footer></body></html>`;
  const page = extractPage(html, "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise");
  assert.equal(page.title, "Promise | MDN");
  assert.ok(page.text.includes("asynchronous operation"));
  assert.ok(page.headings.includes("Promise"));
  assert.ok(
    page.links.some((l) => l.endsWith("/Promise/all")),
    "relative link resolved against the page URL",
  );
});
