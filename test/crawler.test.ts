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

// S2 regression: the page cap must bound TOTAL fetches, not only
// successful pages. Ported from the verdict probe (hub plus 1000 stubs,
// maxPages 5 previously performed 1001 fetches).
const LONG = "Documentation text that is comfortably over the stub threshold. ".repeat(6);

function stubFetchCounting(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  let pageFetches = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    pageFetches++;
    return handler(url);
  }) as typeof fetch;
  return {
    count: () => pageFetches,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("crawlSource bounds total fetches at maxPages when pages are stubs (S2)", async () => {
  const N = 1000;
  const stubLinks = Array.from({ length: N }, (_, i) => `<a href="/docs/stub${i}">s${i}</a>`).join("");
  const hub = `<html><head><title>Hub</title></head><body><main><p>${LONG}</p>${stubLinks}</main></body></html>`;
  const stub = `<html><head><title>Stub</title></head><body><main><p>tiny</p></main></body></html>`;
  const stubbed = stubFetchCounting((url) =>
    url === "https://example.com/docs"
      ? new Response(hub, { headers: { "content-type": "text/html" } })
      : new Response(stub, { headers: { "content-type": "text/html" } }),
  );
  try {
    const source: Source = {
      name: "s2",
      seed: "https://example.com/docs/",
      allowedPrefix: "https://example.com/docs/",
      maxPages: 5,
    };
    const fetched = await crawlSource(source, {}, { delayMs: 0, concurrency: 2 });
    assert.equal(fetched, 1); // only the hub is a successful page
    // Exact bound: attempts are capped at maxPages, so exactly 5 fetches
    // (the hub plus 4 stubs) happen instead of the previous 1001.
    assert.equal(stubbed.count(), 5);
  } finally {
    stubbed.restore();
  }
});

test("crawlSource bounds total fetches at maxPages when pages return 404 (S2)", async () => {
  const N = 300;
  const links = Array.from({ length: N }, (_, i) => `<a href="/docs/missing${i}">m${i}</a>`).join("");
  const hub = `<html><head><title>Hub</title></head><body><main><p>${LONG}</p>${links}</main></body></html>`;
  const stubbed = stubFetchCounting((url) =>
    url === "https://example.com/docs"
      ? new Response(hub, { headers: { "content-type": "text/html" } })
      : new Response("not found", { status: 404, headers: { "content-type": "text/html" } }),
  );
  try {
    const source: Source = {
      name: "s2b",
      seed: "https://example.com/docs/",
      allowedPrefix: "https://example.com/docs/",
      maxPages: 5,
    };
    const fetched = await crawlSource(source, {}, { delayMs: 0, concurrency: 2 });
    assert.equal(fetched, 1);
    // Exact bound: exactly 5 fetches (the hub plus 4 misses) instead of
    // the previous 301.
    assert.equal(stubbed.count(), 5);
  } finally {
    stubbed.restore();
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
