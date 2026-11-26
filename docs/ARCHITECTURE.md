# Quarry — architecture notes

How the engine is put together, the decisions behind it, and the limitations
stated plainly. Everything here describes the code in `src/` as shipped.

## Pipeline

```
seeds ──► crawler ──► data/pages.jsonl ──► indexer ──► data/index.json ──► server
             │                                                    │
       robots.txt + politeness                          BM25 search + snippets
```

## The crawler (`src/crawler.ts`)

- **Breadth-first** from each source's seed, following only links inside the
  source's allowlisted prefix. Asset URLs (images, PDFs, archives, code) are
  skipped by extension.
- **Robots**: each origin's `robots.txt` is fetched once and parsed by hand —
  the `*` group plus a `QuarryBot` group if one exists; `Disallow` paths are
  prefix-matched. If the file is missing or unreachable, crawling proceeds
  (politeness delays still apply).
- **Politeness**: request *starts* to a host are spaced by a minimum delay
  (200 ms default) across all workers; per-host concurrency is 2. The crawler
  identifies itself as `QuarryBot/1.0`.
- **Extraction** (`src/text.ts`): the `<main>` element is preferred when a
  page has one (documentation sites do), falling back to `<article>`, then
  the whole document; scripts, styles, SVGs and nav blocks are stripped.
  Pages under 200 characters of extracted text are treated as stubs and
  dropped.
- **Storage**: pages are appended to `data/pages.jsonl` as they are fetched,
  so an interrupted crawl keeps its progress; a re-run skips storing pages it
  already has.
- **Two extraction lessons baked in**: `href` attributes may be unquoted
  (Node.js docs) — the link pattern accepts quoted and unquoted forms; and
  relative links resolve against the page's *final* URL after redirects,
  in its raw directory form — normalisation strips a directory's
  trailing slash for dedupe, so the slash is restored for resolution
  (`linkBase` in `src/crawler.ts`), because resolving `assert.html`
  against a normalised `.../api` (no trailing slash) silently leaves
  the docs tree.
- **Boilerplate cut**: at index time, template footer blocks that ride
  inside `<main>` (MDN's "Help improve MDN" panel) are cut when their
  marker appears in the latter half of a page — before that cut, the word
  "contributor" appeared in 98% of the corpus.

## The index (`src/engine.ts`)

- **Tokenising**: lowercase, split on non-alphanumerics, drop a ~120-word
  stopword list, then a light suffix stemmer (plurals, `-ing`, `-ed`, `-ly`,
  silent final `-e`, doubled-consonant collapse). The stemmer's job is
  *consistency* — `promise`, `promises` and `promising` all become `promis`
  on both the document side and the query side.
- **Field weighting by repetition**: the indexed token stream is
  `title ×3 + headings ×2 + body ×1`. A term in the title therefore earns
  roughly triple the term frequency of a body mention. Crude, effective, and
  trivially explainable; separate per-field indexes are the cleaner design
  and are deliberately left as an exercise the format can grow into.
- **Postings**: `term → [[docId, [positions…]], …]`. Positions are stored
  (phrase queries are on the roadmap) but v1 ranking uses only term
  frequency, document frequency and document length.
- **Persistence**: one JSON file (`data/index.json`) holding the documents
  (URL, source, title, full text for snippets) and the postings map. Simple
  and inspectable; a segment/binary format is the known next step when the
  corpus outgrows comfortable memory.

## Ranking: BM25

For each query term *t* in document *d*:

```
idf(t)      = ln( 1 + (N − df + 0.5) / (df + 0.5) )
score(d, t) = idf(t) · tf · (k1 + 1) / ( tf + k1 · (1 − b + b · |d| / avgdl) )
```

with `k1 = 1.2`, `b = 0.75` (the standard defaults). Document scores are the
sum over query terms. Properties worth knowing:

- Rare terms dominate: a term appearing in 3 pages carries far more signal
  than one appearing in 3,000.
- Term frequency saturates: the 30th mention of a word adds almost nothing
  over the 10th, which is what makes keyword stuffing useless.
- Length normalisation keeps long reference pages from winning purely by
  containing more words.

## Snippets

The first query-term match in the stored text anchors a ~210-character
window; matched words are wrapped in `**…**` by the engine and rendered as
`<mark>` by the server.

## Limitations, stated plainly

- **Corpus scope**: four documentation sources; the reference crawl indexed
  3,917 pages (MDN hit its 3,500 cap; the other sources' in-prefix trees
  were exhausted below their caps). Quarry is not, and does not claim to
  be, a web-scale engine.
- **No link-graph ranking**: there is no PageRank analogue; ranking is
  content-only (BM25 + field weighting).
- **Light stemmer**: merges the commonest inflections; a full Porter
  stemmer would merge more (and occasionally over-merge).
- **Single-file index**: the whole index loads into memory at boot. Fine at
  this corpus size; it is the first thing that changes at 10–100× scale.
- **Freshness**: re-crawling is manual (re-run the crawl); there is no
  change detection yet, so a re-crawl re-fetches pages it already has for
  traversal even though it never stores duplicates.
