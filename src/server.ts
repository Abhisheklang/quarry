// The Quarry web service: search page, results, JSON API and the index
// dashboard — one dependency-free Node server rendering HTML itself.
//
//   PORT=3000 node src/server.ts
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { search, stats, type Index } from "./engine.ts";

const INDEX_PATH =
  process.env.QUARRY_INDEX ?? new URL("../data/index.json", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 3000);

if (!existsSync(INDEX_PATH)) {
  console.error(
    `No index at ${INDEX_PATH}. Run the crawl and the index build first:\n` +
      `  node src/crawl.ts && node src/build-index.ts`,
  );
  process.exit(1);
}
const index = JSON.parse(readFileSync(INDEX_PATH, "utf-8")) as Index;
const indexSizeMb = Number((statSync(INDEX_PATH).size / 1_000_000).toFixed(1));
const info = stats(index);
console.log(
  `Quarry: ${info.documents} docs, ${info.terms} terms, index ${indexSizeMb} MB — http://localhost:${PORT}`,
);

// ---------- helpers ----------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function snippetHtml(snippet: string): string {
  return esc(snippet).replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>");
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean).slice(-2);
    return `${u.hostname} › ${parts.join(" › ")}`;
  } catch {
    return url;
  }
}

const SOURCE_NAMES = Object.keys(info.sources);

function sourceChips(active: string, q: string): string {
  const chip = (name: string, label: string) =>
    `<a class="chip${active === name ? " chip-active" : ""}" href="/search?q=${encodeURIComponent(q)}${name ? `&source=${encodeURIComponent(name)}` : ""}">${label}</a>`;
  return `<nav class="chips">${chip("", "All")}${SOURCE_NAMES.map((s) => chip(s, s)).join("")}</nav>`;
}

// ---------- pages ----------

const CSS = `
:root{
  --ink:#1c1917; --muted:#78716c; --line:#e7e5e4; --paper:#faf9f7;
  --amber:#d97706; --amber-dark:#b45309; --amber-soft:#fef3c7; --mark:#fde68a;
  --card:#ffffff; --slate-badge:#292524;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
::selection{background:var(--amber-soft)}
body{margin:0;font-family:ui-sans-system,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--paper);color:var(--ink)}
a{color:inherit}
@keyframes rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadein{from{opacity:0}to{opacity:1}}
main.home,.wrap{animation:fadein .18s ease-out}
.home .badge{transition:transform .18s ease}
.home .badge:hover{transform:scale(1.04)}
.home{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px 64px}
.home .badge{width:88px;height:88px;border-radius:22px;box-shadow:0 10px 30px rgba(217,119,6,.25)}
.wordmark{font-size:46px;font-weight:800;letter-spacing:-1.5px;margin:18px 0 2px}
.tagline{color:var(--muted);font-size:17px;margin:0 0 28px}
.searchbox{display:flex;width:min(620px,100%);background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 6px 6px 22px;box-shadow:0 2px 14px rgba(28,25,23,.07)}
.searchbox:focus-within{border-color:var(--amber);box-shadow:0 2px 18px rgba(217,119,6,.22)}
.searchbox input{flex:1;border:0;outline:0;font-size:17px;background:transparent;min-width:0}
.searchbox button{border:0;background:var(--amber);color:#fff;font-size:16px;font-weight:600;border-radius:999px;padding:10px 22px;cursor:pointer;transition:background .15s ease,transform .12s ease,box-shadow .15s ease}
.searchbox button:hover{background:var(--amber-dark);transform:translateY(-1px);box-shadow:0 4px 12px rgba(217,119,6,.35)}
.searchbox button:active{transform:translateY(0) scale(.97);box-shadow:none}
.searchbox button:focus-visible{outline:3px solid var(--amber-soft);outline-offset:2px}
.searchbox button.searching{opacity:.75;pointer-events:none}
.home .stats{margin-top:26px;color:var(--muted);font-size:14px;text-align:center;line-height:1.7}
.home .stats b{color:var(--ink)}
.sources-line{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.pill{background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--muted)}
footer{margin-top:44px;color:var(--muted);font-size:13px;text-align:center;line-height:1.8}
footer a{color:var(--amber-dark);text-decoration:none}
.gh-link{display:inline-flex;color:var(--muted);text-decoration:none}
.gh-link:hover{color:var(--amber-dark)}
.gh-link svg{width:22px;height:22px;fill:currentColor}
.topbar{position:sticky;top:0;background:rgba(250,249,247,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:14px;z-index:5}
.topbar .badge{width:36px;height:36px;border-radius:9px}
.topbar .mini{font-weight:800;font-size:20px;letter-spacing:-.5px;text-decoration:none}
.topbar .searchbox{flex:1;max-width:620px;padding:4px 4px 4px 18px}
.topbar .searchbox input{font-size:15px}
.topbar .searchbox button{padding:7px 16px;font-size:14px}
.topbar .dashlink{margin-left:auto;color:var(--muted);text-decoration:none;font-size:14px;white-space:nowrap}
.wrap{max-width:720px;margin:0 auto;padding:8px 16px 60px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 16px;font-size:13.5px;text-decoration:none;color:var(--muted);transition:background .15s ease,color .15s ease,border-color .15s ease,transform .12s ease}
.chip:hover{border-color:var(--amber);color:var(--amber-dark)}
.chip:active{transform:scale(.96)}
.chip-active{background:var(--slate-badge);color:#fff;border-color:var(--slate-badge)}
.chip-active:hover{color:#fff}
.resultline{color:var(--muted);font-size:13.5px;margin:10px 0 18px}
.result{margin:0 0 28px;animation:rise .18s ease-out backwards}
.result .urlrow{display:flex;align-items:center;gap:8px;margin-bottom:3px}
.srcbadge{background:var(--amber-soft);color:var(--amber-dark);font-size:11.5px;font-weight:700;border-radius:6px;padding:2px 7px;text-transform:uppercase;letter-spacing:.4px}
.result .url{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.result h3{margin:0 0 3px;font-size:19.5px;font-weight:600;line-height:1.3}
.result h3 a{color:#1e3a8a;text-decoration:none;transition:color .15s ease}
.result h3 a:hover{text-decoration:underline;color:var(--amber-dark)}
.result p{margin:0;color:#44403c;font-size:14.5px;line-height:1.55}
mark{background:var(--mark);color:inherit;padding:0 1px;border-radius:2px}
.empty{background:#fff;border:1px solid var(--line);border-radius:14px;padding:26px;margin-top:22px}
.empty h2{margin:0 0 8px;font-size:19px}
.empty p{color:var(--muted);margin:0;line-height:1.6}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;transition:transform .15s ease,box-shadow .15s ease}
.card:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(28,25,23,.08)}
.card .num{font-size:30px;font-weight:800;letter-spacing:-.5px}
.card .lbl{color:var(--muted);font-size:13px;margin-top:2px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin:0 0 16px}
.panel h2{margin:0 0 14px;font-size:17px}
.bar-row{display:grid;grid-template-columns:110px 1fr 60px;align-items:center;gap:10px;margin:9px 0;font-size:14px}
.bar-track{background:var(--line);border-radius:99px;height:10px;overflow:hidden}
.bar-fill{background:linear-gradient(90deg,var(--amber),#f59e0b);height:100%;border-radius:99px}
.bar-row .n{text-align:right;color:var(--muted)}
.terms{display:flex;flex-wrap:wrap;gap:7px}
.term{background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:13px;color:#44403c}
.term b{color:var(--amber-dark)}
.dash-head{display:flex;align-items:center;gap:12px;margin:22px 0 4px}
.dash-head .badge{width:44px;height:44px;border-radius:11px}
.dash-head h1{font-size:26px;margin:0;letter-spacing:-.5px}
@media (max-width:560px){ .wordmark{font-size:38px} .topbar .dashlink{display:none} .result h3{font-size:18px} }
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.01ms !important;animation-delay:0ms !important;transition-duration:.01ms !important}
}
`;

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<style>${CSS}</style>
</head>
<body>${body}
<script>
// Interaction feedback: a submitted search always answers back, and "/"
// jumps to the search box from anywhere on the page.
document.querySelectorAll("form.searchbox").forEach((form) => {
  form.addEventListener("submit", () => {
    const btn = form.querySelector("button");
    if (btn) {
      btn.textContent = "Searching…";
      btn.classList.add("searching");
    }
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    document.querySelector('.searchbox input[name="q"]')?.focus();
  }
});
</script>
</body>
</html>`;
}

function homePage(): string {
  const body = `
<main class="home">
  <img class="badge" src="/assets/logo.png" alt="Quarry logo">
  <h1 class="wordmark">Quarry</h1>
  <p class="tagline">Search the docs. Own the engine.</p>
  <form class="searchbox" action="/search" method="get" role="search">
    <input name="q" type="search" placeholder="Try: how do promises work" autofocus aria-label="Search query">
    <button type="submit">Search</button>
  </form>
  <div class="stats">
    <b>${info.documents.toLocaleString()}</b> pages indexed · <b>${info.terms.toLocaleString()}</b> terms · crawled and ranked by Quarry itself
    <div class="sources-line">${SOURCE_NAMES.map((s) => `<span class="pill">${esc(s)} · ${info.sources[s].toLocaleString()}</span>`).join("")}</div>
  </div>
  <footer>
    A working search engine built from scratch — own crawler, own index, own ranking. No search APIs.<br>
    <a href="/dashboard">Index dashboard</a> · <a href="/api/stats">API</a>
  </footer>
</main>`;
  return pageShell("Quarry — search the docs", body);
}

const PAGE_SIZE = 10;

function resultsPage(q: string, source: string, page = 1): string {
  let outcome = search(index, q, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    source: source || undefined,
  });
  const totalPages = Math.max(1, Math.ceil(outcome.total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  if (currentPage !== page) {
    // Asked for a page past the end: serve the last page instead of none.
    outcome = search(index, q, {
      limit: PAGE_SIZE,
      offset: (currentPage - 1) * PAGE_SIZE,
      source: source || undefined,
    });
  }
  const pageLink = (n: number, label: string) =>
    `<a class="chip" href="/search?q=${encodeURIComponent(q)}${source ? `&source=${encodeURIComponent(source)}` : ""}&page=${n}">${label}</a>`;
  const pager =
    totalPages > 1
      ? `<nav class="chips" aria-label="Result pages">${currentPage > 1 ? pageLink(currentPage - 1, "← Previous") : ""}<span class="chip chip-active">Page ${currentPage} of ${totalPages.toLocaleString()}</span>${currentPage < totalPages ? pageLink(currentPage + 1, "Next →") : ""}</nav>`
      : "";
  const items = outcome.results
    .map(
      (r, i) => `
<article class="result" style="animation-delay:${Math.min(i * 25, 200)}ms">
  <div class="urlrow"><span class="srcbadge">${esc(r.source)}</span><span class="url">${esc(prettyUrl(r.url))}</span></div>
  <h3><a href="${esc(r.url)}">${esc(r.title)}</a></h3>
  <p>${snippetHtml(r.snippet)}</p>
</article>`,
    )
    .join("");
  const body = `
<header class="topbar">
  <a href="/"><img class="badge" src="/assets/logo.png" alt="Quarry"></a>
  <a class="mini" href="/">Quarry</a>
  <form class="searchbox" action="/search" method="get" role="search">
    <input name="q" type="search" value="${esc(q)}" aria-label="Search query">
    ${source ? `<input type="hidden" name="source" value="${esc(source)}">` : ""}
    <button type="submit">Search</button>
  </form>
  <a class="dashlink" href="/dashboard">Index dashboard</a>
</header>
<div class="wrap">
  ${sourceChips(source, q)}
  <p class="resultline">About ${outcome.total.toLocaleString()} results (${outcome.timeMs < 1000 ? `${outcome.timeMs} ms` : `${(outcome.timeMs / 1000).toFixed(2)} seconds`}) in ${source ? esc(source) : "all sources"}</p>
  ${outcome.results.length ? items : `<div class="empty"><h2>No results for “${esc(q)}”</h2><p>Quarry only answers from pages its crawler actually fetched. Try different words, or check the <a href="/dashboard">index dashboard</a> to see what the corpus covers.</p></div>`}
  ${pager}
</div>`;
  return pageShell(`${q} — Quarry`, body);
}

function dashboardPage(): string {
  const max = Math.max(...Object.values(info.sources));
  const bars = Object.entries(info.sources)
    .map(
      ([name, count]) => `
<div class="bar-row"><span>${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round((count / max) * 100)}%"></div></div><span class="n">${count.toLocaleString()}</span></div>`,
    )
    .join("");
  const terms = info.topTerms
    .map((t) => `<span class="term">${esc(t.term)} <b>${t.documents.toLocaleString()}</b></span>`)
    .join("");
  const body = `
<div class="wrap" style="max-width:860px">
  <div class="dash-head">
    <a href="/"><img class="badge" src="/assets/logo.png" alt="Quarry"></a>
    <div><h1>Index dashboard</h1><div style="color:var(--muted);font-size:13.5px">The machinery, measured — not claimed.</div></div>
  </div>
  <div class="cards">
    <div class="card"><div class="num">${info.documents.toLocaleString()}</div><div class="lbl">pages indexed</div></div>
    <div class="card"><div class="num">${info.terms.toLocaleString()}</div><div class="lbl">unique terms</div></div>
    <div class="card"><div class="num">${info.avgDocLength.toLocaleString()}</div><div class="lbl">avg tokens / page</div></div>
    <div class="card"><div class="num">${indexSizeMb} MB</div><div class="lbl">index size on disk</div></div>
  </div>
  <section class="panel"><h2>Pages by source</h2>${bars}</section>
  <section class="panel"><h2>Most widespread terms</h2><div class="terms">${terms}</div>
  <p style="color:var(--muted);font-size:13px;margin:14px 0 0">Number = in how many pages the term appears. Index built ${esc(new Date(info.builtAt).toUTCString())}.</p></section>
  <p><a href="/" style="color:var(--amber-dark);text-decoration:none">← Back to search</a></p>
  <footer>
    <a class="gh-link" href="https://github.com/Abhisheklang" target="_blank" rel="noreferrer" aria-label="GitHub profile of Abhisheklang"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg></a>
  </footer>
</div>`;
  return pageShell("Index dashboard — Quarry", body);
}

// ---------- server ----------

// Security headers applied to every response in send(). The pages are
// server-rendered by this same server and use an inline <style> block, an
// inline <script> block and inline style attributes, so script-src and
// style-src allow 'unsafe-inline' for 'self' content only; everything else
// is locked to 'self' and framing is denied outright.
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
};

// Basic per-IP rate limit for the JSON API routes (fixed window, in
// memory, Node built-ins only). 60 requests per minute per IP is far
// above human dashboard use (a page load plus a handful of searches) and
// the crawler never calls this server, so only bursts trip it.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (rateBuckets.size > 10_000) {
    for (const [key, b] of rateBuckets) {
      if (now >= b.resetAt) rateBuckets.delete(key);
    }
  }
  return bucket.count > RATE_LIMIT;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (code: number, type: string, body: string | Buffer) => {
    res.writeHead(code, { "content-type": type, ...SECURITY_HEADERS });
    res.end(body);
  };

  // The server is read-only: only GET and HEAD are meaningful. Anything
  // else gets a 405 instead of being silently served like a GET.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      "content-type": "text/plain; charset=utf-8",
      allow: "GET, HEAD",
      ...SECURITY_HEADERS,
    });
    return res.end("Method not allowed");
  }

  if (url.pathname === "/api/search" || url.pathname === "/api/stats") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip)) {
      return send(429, "application/json", `{"error":"rate limit exceeded"}`);
    }
  }

  if (url.pathname === "/") return send(200, "text/html; charset=utf-8", homePage());
  if (url.pathname === "/search") {
    const q = url.searchParams.get("q") ?? "";
    const source = url.searchParams.get("source") ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    return send(200, "text/html; charset=utf-8", resultsPage(q, source, page));
  }
  if (url.pathname === "/dashboard") {
    return send(200, "text/html; charset=utf-8", dashboardPage());
  }
  if (url.pathname === "/api/search") {
    const q = url.searchParams.get("q") ?? "";
    const source = url.searchParams.get("source") ?? undefined;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 10) || 10));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const outcome = search(index, q, { limit, offset, source });
    return send(
      200,
      "application/json",
      JSON.stringify({ query: q, ...outcome }, null, 2),
    );
  }
  if (url.pathname === "/api/stats") {
    return send(200, "application/json", JSON.stringify({ ...info, indexSizeMb }, null, 2));
  }
  if (url.pathname === "/assets/logo.png" || url.pathname === "/assets/favicon.png") {
    const file = new URL(`../assets/${url.pathname.split("/").pop()}`, import.meta.url).pathname;
    if (existsSync(file)) return send(200, "image/png", readFileSync(file));
  }
  if (url.pathname === "/assets/logo.svg") {
    const file = new URL("../assets/logo.svg", import.meta.url).pathname;
    if (existsSync(file)) return send(200, "image/svg+xml", readFileSync(file));
  }
  if (url.pathname === "/health") return send(200, "application/json", `{"ok":true}`);
  return send(404, "text/html; charset=utf-8", pageShell("Not found — Quarry", `<div class="wrap"><div class="empty"><h2>404</h2><p>That page is not in the index — or anywhere else here. <a href="/">Back to search</a></p></div></div>`));
});

server.listen(PORT);
