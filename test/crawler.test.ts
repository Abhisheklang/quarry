import { test } from "node:test";
import assert from "node:assert/strict";
import { readBodyCapped, crawlSource, type CrawledPage, type Source } from "../src/crawler.ts";

test("readBodyCapped returns a small body in full", async () => {
  const res = new Response("hello world");
  assert.equal(await readBodyCapped(res, 1000), "hello world");
});

test("readBodyCapped rejects a body whose content-length already exceeds the cap", async () => {
  const res = new Response("x".repeat(200), {
    headers: { "content-length": "200" },
  });
  assert.equal(await readBodyCapped(res, 100), null);
});

test("readBodyCapped aborts a streamed body once it passes the cap", async () => {
  const chunk = new TextEncoder().encode("y".repeat(60));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk); // endless 60-byte chunks
    },
  });
  const res = new Response(stream);
  assert.equal(await readBodyCapped(res, 100), null);
});

const DOC_HTML = `<html><head><title>Doc</title></head><body><main>
<p>${"Documentation text that is comfortably over the stub threshold. ".repeat(6)}</p>
</main></body></html>`;

const DOC_SOURCE: Source = {
  name: "test",
  seed: "https://example.com/docs/",
  allowedPrefix: "https://example.com/docs/",
  maxPages: 10,
};

function stubFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    return handler(url);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("crawlSource skips a redirect that leaves the allowed prefix", async () => {
  const restore = stubFetch(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.net/docs/page" },
      }),
  );
  try {
    const pages: CrawledPage[] = [];
    const fetched = await crawlSource(DOC_SOURCE, { onPage: (p) => pages.push(p) }, { delayMs: 0 });
    assert.equal(fetched, 0);
    assert.equal(pages.length, 0);
  } finally {
    restore();
  }
});

test("crawlSource follows an in-prefix redirect and stores the page under the final URL", async () => {
  const restore = stubFetch((url) => {
    if (url === "https://example.com/docs/final") {
      return new Response(DOC_HTML, { headers: { "content-type": "text/html" } });
    }
    return new Response(null, {
      status: 301,
      headers: { location: "/docs/final" },
    });
  });
  try {
    const pages: CrawledPage[] = [];
    const fetched = await crawlSource(DOC_SOURCE, { onPage: (p) => pages.push(p) }, { delayMs: 0 });
    assert.equal(fetched, 1);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].url, "https://example.com/docs/final");
  } finally {
    restore();
  }
});

test("crawlSource stores a direct 200 response under its own URL", async () => {
  const restore = stubFetch(
    () => new Response(DOC_HTML, { headers: { "content-type": "text/html" } }),
  );
  try {
    const pages: CrawledPage[] = [];
    const fetched = await crawlSource(DOC_SOURCE, { onPage: (p) => pages.push(p) }, { delayMs: 0 });
    assert.equal(fetched, 1);
    assert.equal(pages[0].url, "https://example.com/docs");
  } finally {
    restore();
  }
});
