import { test } from "node:test";
import assert from "node:assert/strict";
import { readBodyCapped } from "../src/crawler.ts";

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
