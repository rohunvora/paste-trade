# SKILL.md Reference Index

Every rule gets an ID: section number + letter. Say "change 8g" not "the step count rule in narrate."

`Flow` column:

- `in:` upstream input, producer, or prior rule this depends on
- `out:` downstream field, file, or later rule this feeds

`File` column — where the rule text lives:

- *(blank)* — SKILL.md (main file)
- `dense.md` — `references/dense.md` (dense source enrichment + extraction)
- `sparse.md` — `references/sparse.md` (sparse source reasoning tree, §6-§9)

Core data objects:

- `extract output` = metadata + `saved_to` from `extract.ts`
- `source run` = `source_id`, `source_url`, `run_id`
- `enriched metadata` = `author_handle`, `source_date`, `title`, `speakers`, `thumbnail_url`
- `canonical transcript` = chosen `saved_to` file path
- `thesis record` = saved thesis JSON + `thesis_id`
- `route package` = final `who` + `route_evidence` + `derivation`
- `post payload` = trade fields sent to `post.ts`
- `finalize payload` = `source_id` + `source_theses` + `source_summary` + `message`

## Sections


| #   | Title      | Lines   | Flow focus                                                                |
| --- | ---------- | ------- | ------------------------------------------------------------------------- |
| 0   | Intro      | 16-20   | Run-wide narration and supporting refs                                    |
| 1   | Defaults   | 22-28   | Global trade and reply defaults                                           |
| 2   | Chat UX    | 30-35   | Live status messaging                                                     |
| 3   | Classify   | 39-43   | Input type -> workflow branch                                             |
| 4   | Extract    | 45-84   | Raw source -> extract output -> source run                                |
| 5   | Enrich     | 86-109  | Source run + transcript -> enriched metadata                              |
| 6   | Theses     | 111-190 | Transcript -> thesis records                                              |
| 7   | Research   | 192-298 | Thesis records -> route evidence (dense only; sparse in sparse.md)        |
| 8   | Narrate    | 300-337 | Source + research -> derivation (dense only; sparse in sparse.md)         |
| 9   | Price      | 339-369 | Route output -> persisted route package (dense only; sparse in sparse.md) |
| 10  | Post       | 371-403 | Route package -> post/finalize payloads                                   |
| 11  | Contract   | 405-451 | Field-level post/finalize contract                                        |
| 12  | Reply      | 453-477 | Saved trade data -> final chat reply                                      |
| 13  | Hard Rules | 479-485 | Run-wide guardrails                                                       |


---

## 0 - Intro


| ID  | Line | Rule                                                       | Flow                      | File |
| --- | ---- | ---------------------------------------------------------- | ------------------------- | ---- |
| 0a  | 18   | Think through trades live. Narrate what changed your mind. | in: whole run state       |      |
| 0b  | 20   | Supporting docs in `references/`                     | in: routing or venue gaps |      |


## 1 - Defaults


| ID  | Line | Rule                               | Flow                       | File |
| --- | ---- | ---------------------------------- | -------------------------- | ---- |
| 1a  | 24   | $100K risk capital, max upside     | in: none                   |      |
| 1b  | 25   | Robinhood + Hyperliquid first      | in: venue choice           |      |
| 1c  | 26   | Best single trade per thesis       | in: thesis routing choices |      |
| 1d  | 27   | No em dashes in output             | in: generated copy         |      |
| 1e  | 28   | End every response with disclaimer | in: final reply            |      |


## 2 - Chat UX


| ID  | Line | Rule                                         | Flow                                 | File     |
| --- | ---- | -------------------------------------------- | ------------------------------------ | -------- |
| 2a  | 32   | Keep chat updates operational and brief      | in: live run updates                 |          |
| 2b  | 33   | First status: "Running /trade now..."        | in: run start                        |          |
| 2c  | 34   | Transcript sources: set duration expectation | in: transcript-source classification | dense.md |
| 2d  | 35   | After source creation: send live link, then keep going | in: `source_url` from 4b     |          |


## 3 - Classify


| ID  | Line | Rule                                                                | Flow                 | File |
| --- | ---- | ------------------------------------------------------------------- | -------------------- | ---- |
| 3a  | 41   | URL source: extract first                                           | in: raw URL          |      |
| 3b  | 42   | User-typed thesis: skip extraction. Exact input is `headline_quote` | in: user thesis text |      |
| 3c  | 43   | paste.trade URLs: treat as normal source                            | in: paste.trade URL  |      |


## 4 - Extract

Execution sequence:


| ID  | Line | Rule                                                         | Flow                            | File |
| --- | ---- | ------------------------------------------------------------ | ------------------------------- | ---- |
| 4a  | 64   | Run extract.ts first                                         | in: URL source (3a/3c)          |      |
| 4b  | 65   | Immediately run create-source.ts, send live URL, keep running | in: extract output            |      |
| 4c  | 66   | Do NOT read saved_to before source creation                  | in: extract `saved_to`          |      |
| 4d  | 67   | Only after source creation: enrichment, transcripts, uploads | in: source run + extract output |      |


Notes:


| ID  | Line | Rule                                                      | Flow                              | File     |
| --- | ---- | --------------------------------------------------------- | --------------------------------- | -------- |
| 4e  | 71   | author_handle = source publisher/channel handle           | in: extract author/channel fields |          |
| 4f  | 72   | YouTube uses channel_handle, not guest speaker            | in: `channel_handle`              | dense.md |
| 4g  | 73   | word_count, duration_seconds, speakers_count are optional | in: extract metadata              |          |
| 4h  | 74   | Save run_id, thread through every later call              | in: source run response           |          |
| 4i  | 75   | Internal tracing: pass run_id from prompt                 | in: prompt `run_id`               |          |
| 4j  | 76   | Use canonical live-link line from Chat UX                 | in: 2d + `source_url`             |          |
| 4k  | 84   | Tell user "Watch live: {source_url}" and continue the run | in: `source_url`                |          |


## 5 - Enrich

Timing:


| ID  | Line | Rule                                                    | Flow                            | File |
| --- | ---- | ------------------------------------------------------- | ------------------------------- | ---- |
| 5a  | 89   | Runs after source page exists, before thesis extraction | in: source run + extract output |      |


Metadata:


| ID  | Line | Rule                                                                                                   | Flow                              | File |
| --- | ---- | ------------------------------------------------------------------------------------------------------ | --------------------------------- | ---- |
| 5b  | 93   | Check extraction for missing author_handle, source_date, title                                         | in: extract output                |      |
| 5c  | 94   | Author missing: scan text, then web search                                                             | in: extract text/URL/title        |      |
| 5d  | 95   | source_date missing: scan text, web search, current ISO 8601 datetime last resort. Always include time | in: extract text/URL/current date |      |
| 5e  | 96   | Enriched metadata used in trade posts (source page stays as-is)                                        | in: enriched metadata             |      |


Dense source enrichment (detail in dense.md, SKILL.md line 99 references it):


| ID  | Line | Rule                                                     | Flow                                           | File     |
| --- | ---- | -------------------------------------------------------- | ---------------------------------------------- | -------- |
| 5f  | —    | Check title + description for multi-speaker indicators   | in: title + description                        | dense.md |
| 5g  | —    | Multi-speaker + GEMINI_API_KEY: run diarize.ts           | in: multi-speaker signal + source URL + key    | dense.md |
| 5h  | —    | Multi-speaker + no key: offer user choice                | in: multi-speaker signal + missing key         | dense.md |
| 5i  | —    | Not multi-speaker: read transcript from saved_to         | in: extract `saved_to`                         | dense.md |
| 5j  | —    | Web search for each speaker's X handle                   | in: named speakers from transcript             | dense.md |
| 5k  | —    | Use resolved handles as author_handle on per-trade posts | in: speaker handles                            | dense.md |
| 5l  | —    | Source-level author stays as channel                     | in: channel handle + speaker handles           | dense.md |
| 5m  | 101  | Avatars not in scope: backend auto-resolves              | in: author identity                            |          |
| 5n  | —    | Default: use extract saved_to                            | in: extract `saved_to`                         | dense.md |
| 5o  | —    | If diarized: switch to diarize saved_to                  | in: diarize `saved_to`                         | dense.md |
| 5p  | —    | Always read from file path, not tool output              | in: extract/diarize output                     | dense.md |
| 5q  | —    | Upload full text once per run                            | in: canonical transcript + `source_id`         | dense.md |
| 5r  | 105  | Push enriched metadata before thesis extraction          | in: `source_id` + `run_id` + enriched metadata |          |


## 6 - Theses

Core:


| ID  | Line | Rule                                                            | Flow                                     | File |
| --- | ---- | --------------------------------------------------------------- | ---------------------------------------- | ---- |
| 6a  | 114  | Read canonical source artifact, find every tradeable thesis     | in: canonical transcript/source artifact |      |
| 6b  | 116  | Thesis = directional belief about what changes and price impact | in: source claims                        |      |


Three-pass (detail in dense.md):


| ID  | Line | Rule                                                       | Flow            | File     |
| --- | ---- | ---------------------------------------------------------- | --------------- | -------- |
| 6f  | —    | Pass 1: list every directional belief with anchoring quote | in: source      | dense.md |
| 6g  | —    | Pass 2: ideate 1-3 trade expressions per belief            | in: belief list | dense.md |
| 6h  | —    | Pass 3: save each as unrouted record                       | in: thesis JSON | dense.md |


Schema and routing:


| ID  | Line    | Rule                                                             | Flow                             | File      |
| --- | ------- | ---------------------------------------------------------------- | -------------------------------- | --------- |
| 6i  | 124-138 | Thesis JSON schema [schema]                                      | in: source extraction data       |           |
| 6j  | 119     | Dense source: read dense.md for three-pass, thesis map, chunking | in: dense-source classification  | dense.md  |
| 6k  | 120     | Sparse source: read sparse.md. Handles §6-§9. Resume at §10 Post | in: sparse-source classification | sparse.md |


Who field:


| ID  | Line    | Rule                                                              | Flow                     | File |
| --- | ------- | ----------------------------------------------------------------- | ------------------------ | ---- |
| 6l  | 142     | who = 1-3 trade ideas, starting points not final                  | in: ideation pass        |      |
| 6m  | 144     | One thesis = one belief (instruments are who entries, not theses) | in: candidate belief set |      |
| 6n  | 146-150 | Think across instrument types (PM for events, HL for sectors)     | in: thesis theme         |      |
| 6o  | 152     | Unresolved: do not drop, save with unrouted_reason                | in: unresolved candidate |      |


Save and parallel:


| ID  | Line    | Rule                                              | Flow                                 | File     |
| --- | ------- | ------------------------------------------------- | ------------------------------------ | -------- |
| 6p  | —       | Narrate thesis map to live page after first pass  | in: first-pass thesis map + `run_id` | dense.md |
| 6q  | 182     | Track returned thesis IDs for finalization        | in: save/batch-save response ids     |          |
| 6r  | 184-185 | Narrate transition before research starts         | in: `run_id`                         |          |
| 6s  | —       | Parallelize routing across theses                 | in: independent thesis records       | dense.md |
| 6t  | 187-189 | Always check ok/error in save/post output         | in: save/post responses              |          |
| 6u  | 190     | Don't use routing difficulty as extraction filter | in: candidate belief set             |          |


Long transcripts (detail in dense.md):


| ID  | Line | Rule                                                       | Flow                                | File     |
| --- | ---- | ---------------------------------------------------------- | ----------------------------------- | -------- |
| 6v  | —    | Split extraction by chunk if 3+ parts or word_count > 8000 | in: transcript parts + `word_count` | dense.md |
| 6w  | —    | Only parallelize if word_count > 8000 or chars > 45000     | in: `word_count`/chars              | dense.md |
| 6x  | —    | Below threshold: sequential in main thread                 | in: below-threshold transcript      | dense.md |
| 6y  | —    | Workers extraction-only; main thread merges/dedupes        | in: worker extraction outputs       | dense.md |


## 7 - Research

Sparse sources: §7-§9 are handled in `references/sparse.md`. Skip to §10.

Venues:


| ID  | Line    | Rule                                          | Flow                                | File |
| --- | ------- | --------------------------------------------- | ----------------------------------- | ---- |
| 7a  | 199-206 | Supported: Hyperliquid, Robinhood, Polymarket | in: thesis `who[]` + venue universe |      |


Parallel steps:


| ID  | Line    | Rule                                                     | Flow                                                | File |
| --- | ------- | -------------------------------------------------------- | --------------------------------------------------- | ---- |
| 7b  | 209-213 | Web search: verify thesis, find instruments, cite in why | in: thesis + provisional `who[]`                    |      |
| 7c  | 214-220 | discover.ts: search HL + PM instruments                  | in: thesis keywords/`who[]`                         |      |
| 7d  | 221-226 | source-excerpt.ts: retrieve surrounding context          | in: canonical transcript + thesis keywords/quote    |      |
| 7e  | 227-228 | route.ts: validate candidates, get pricing               | in: candidate tickers + source-date/horizon context |      |
| 7f  | 229-233 | Select tightest quote-to-instrument link                 | in: 7b/7c/7d/7e outputs                             |      |


Venue upgrades:


| ID  | Line    | Rule                                                      | Flow                                    | File |
| --- | ------- | --------------------------------------------------------- | --------------------------------------- | ---- |
| 7g  | 236-238 | ETFs/broad stocks: check HL for thematic perp             | in: ETF/broad-stock candidate           |      |
| 7h  | 239-241 | Event-driven: check Polymarket for binary contract        | in: event-driven thesis                 |      |
| 7i  | 242     | Better venue exists: route there, original as alternative | in: original candidate + venue upgrades |      |


Requirements:


| ID  | Line    | Rule                                                      | Flow                            | File |
| --- | ------- | --------------------------------------------------------- | ------------------------------- | ---- |
| 7j  | 246     | Both HL and RH: prefer Hyperliquid                        | in: dual HL/RH executability    |      |
| 7k  | 247-248 | Non-direct ticker: explicit proxy reasoning + citations   | in: proxy route choice          |      |
| 7l  | 249-250 | Quote-to-trade check: author wouldn't recognize = reroute | in: quote + selected expression |      |


Directness:


| ID  | Line | Rule                                                         | Flow                                      | File |
| --- | ---- | ------------------------------------------------------------ | ----------------------------------------- | ---- |
| 7m  | 254  | direct = author would recognize as their trade               | in: source wording vs selected expression |      |
| 7n  | 255  | derived = author didn't name it, link immediate + defensible | in: source wording vs selected expression |      |


Route evidence:


| ID  | Line    | Rule                                                       | Flow                                                   | File |
| --- | ------- | ---------------------------------------------------------- | ------------------------------------------------------ | ---- |
| 7o  | 259-287 | Route evidence JSON schema [schema]                        | in: route output + selected expression + direct checks |      |
| 7p  | 291     | routed_ticker -> selected_expression.ticker                | in: `routed_ticker` from route output                  |      |
| 7q  | 292     | Keep instrument/platform strings as returned               | in: route instrument/platform strings                  |      |
| 7r  | 293     | Proxy route: include fallback_reason_tag                   | in: proxy route selection                              |      |
| 7s  | 295-298 | Cross-reference: subjects <-> direct_checks, ticker in who | in: `route_evidence` + updated `who[]`                 |      |


## 8 - Narrate


| ID  | Line    | Rule                                                    | Flow                                                | File |
| --- | ------- | ------------------------------------------------------- | --------------------------------------------------- | ---- |
| 8a  | 302-316 | Derivation chain JSON schema [schema]                   | in: source quotes/context + research + speaker data |      |
| 8b  | 318-320 | Write explanation for every routed trade, 1-2 sentences | in: derivation reasoning                            |      |
| 8c  | 322-326 | Steps earn the conclusion, not summarize it             | in: route logic + research                          |      |


Rules:


| ID  | Line | Rule                                                                 | Flow                                      | File |
| --- | ---- | -------------------------------------------------------------------- | ----------------------------------------- | ---- |
| 8d  | 331  | Provenance: segment = sourced, url = researched, neither = inference | in: step fields (`segment`/`url`)         |      |
| 8e  | 332  | Inline numbered citations: [1](url), [2](url)                        | in: research URLs                         |      |
| 8f  | 333  | url on step is fallback when inline doesn't fit                      | in: research URL                          |      |
| 8g  | 334  | 2-5 steps                                                            | in: `derivation.steps[]`                  |      |
| 8h  | 335  | Be honest when step is your own inference                            | in: inference steps                       |      |
| 8i  | 336  | User thesis: their words are the segment, speaker: "user"            | in: user-thesis path (3b)                 |      |
| 8j  | 337  | Video/podcast: timestamps + resolve speaker X handles                | in: video/podcast transcript + 5j handles |      |


## 9 - Price

Instrument preference:


| ID  | Line    | Rule                                                                    | Flow                                        | File |
| --- | ------- | ----------------------------------------------------------------------- | ------------------------------------------- | ---- |
| 9a  | 343     | Direct thesis on HL -> perps                                            | in: direct thesis subject + HL availability |      |
| 9b  | 344-345 | Sector/commodity/index with HL equiv -> HL perps (not specific company) | in: broad thesis + HL equivalent            |      |
| 9c  | 346-347 | Binary event with PM contract -> prediction market (skip pure price)    | in: binary event thesis + PM contract       |      |
| 9d  | 348     | Otherwise -> shares                                                     | in: no better derivative venue              |      |
| 9e  | 349     | No direct route -> best proxy                                           | in: no direct executable route              |      |


Pricing:


| ID  | Line    | Rule                                                    | Flow                                                                         | File |
| --- | ------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| 9f  | 361     | Use tool numbers directly, don't estimate               | in: route `price_context` tool output                                        |      |
| 9g  | 363-367 | Persist who + route_evidence + derivation in one update | in: `thesis_id` + final `who[]` + `route_evidence` + `derivation` + `run_id` |      |
| 9h  | 369     | Save emits thesis_routed/thesis_dropped automatically   | in: save.ts update result                                                    |      |


## 10 - Post

Post rules:


| ID  | Line | Rule                                                                      | Flow                                                    | File |
| --- | ---- | ------------------------------------------------------------------------- | ------------------------------------------------------- | ---- |
| 10a | 381  | headline_quote must exactly match one saved quotes[]                      | in: saved `quotes[]` + post payload `headline_quote`    |      |
| 10b | 382  | ticker/direction/instrument/platform/trade_type must match route_evidence | in: `route_evidence.selected_expression` + post payload |      |
| 10c | 383  | Carry source_date_price and since_published_move_pct from route           | in: route `price_context`                               |      |
| 10d | 384  | post.ts baseline backfill is fallback, not primary                        | in: incomplete post payload                             |      |


Finalization:


| ID  | Line | Rule                                                       | Flow                               | File |
| --- | ---- | ---------------------------------------------------------- | ---------------------------------- | ---- |
| 10e | 394  | source_id: source page being completed                     | in: source run `source_id`         |      |
| 10f | 395  | source_theses: all theses, routed and unrouted             | in: all saved thesis records       |      |
| 10g | 396  | Each entry must carry thesis_id from save.ts               | in: `thesis_id` from 6q            |      |
| 10h | 397  | Each routed entry must include non-empty who               | in: routed thesis record           |      |
| 10i | 398  | Each unrouted entry must include non-empty unrouted_reason | in: unrouted thesis record         |      |
| 10j | 399  | Every thesis appears exactly once (no drops, no dupes)     | in: extracted thesis set + updates |      |
| 10k | 400  | source_summary: one-line summary                           | in: whole source + thesis set      |      |
| 10l | 401  | message: optional                                          | in: operator completion note       |      |
| 10m | 403  | Don't rely on trade POST to resolve source page            | in: post success state             |      |


## 11 - Contract

Required fields:


| ID  | Line | Field                                                 | Flow                                                  | File |
| --- | ---- | ----------------------------------------------------- | ----------------------------------------------------- | ---- |
| 11a | 411  | ticker (use routed_ticker if returned)                | in: 7p `routed_ticker` / `selected_expression.ticker` |      |
| 11b | 412  | direction (long/short)                                | in: `selected_expression.direction`                   |      |
| 11c | 413  | publish_price (source_date_price from route)          | in: route `price_context.source_date_price`           |      |
| 11d | 414  | source_date_price (required for baseline P&L)         | in: route `price_context.source_date_price`           |      |
| 11e | 415  | since_published_move_pct (required when available)    | in: route `price_context.since_published_move_pct`    |      |
| 11f | 416  | thesis                                                | in: thesis record `thesis`                            |      |
| 11g | 417  | headline_quote (exact match to quotes[], <=120 chars) | in: thesis record `headline_quote`/`quotes[]`         |      |
| 11h | 418  | ticker_context (1-3 sentences, no jargon)             | in: selected expression + research/proxy reasoning    |      |
| 11i | 419  | author_handle (speaker/author)                        | in: 4e/4f source author or 5j/5k speaker handle       |      |
| 11j | 420  | author_platform (youtube, x, substack, etc.)          | in: source platform/classification                    |      |
| 11k | 421  | source_url (string or null)                           | in: source run/original source URL                    |      |
| 11l | 422  | source_date (ISO 8601)                                | in: extract or enriched `source_date` (5d/5r)         |      |
| 11m | 423  | trade_type (direct/derived)                           | in: 7m/7n directness classification                   |      |
| 11n | 424  | instrument (shares/perps)                             | in: 7q/9a-9e instrument choice                        |      |
| 11o | 425  | platform (robinhood/hyperliquid)                      | in: 7q/7j/9a-9e platform choice                       |      |
| 11p | 426  | thesis_id (from save.ts)                              | in: 6q save.ts id                                     |      |
| 11q | 427  | derivation ({ explanation, segments, steps })         | in: 8a-8j derivation build                            |      |


Source fields:


| ID  | Line    | Field                                                         | Flow                                                      | File |
| --- | ------- | ------------------------------------------------------------- | --------------------------------------------------------- | ---- |
| 11r | 431     | source_title                                                  | in: extract/enriched title                                |      |
| 11s | 432     | source_images                                                 | in: extract source images                                 |      |
| 11t | 436     | source_theses (finalization)                                  | in: 10f-10j finalized thesis set                          |      |
| 11u | 437     | source_summary (finalization)                                 | in: 10k `source_summary`                                  |      |
| 11v | 439-445 | Optional: pnl_dollars, horizon, kills, alt_venues, avatar_url | in: route price data, horizon, alt venues, avatar backend |      |


Notes:


| ID  | Line | Rule                                                 | Flow                                  | File |
| --- | ---- | ---------------------------------------------------- | ------------------------------------- | ---- |
| 11w | 449  | Card price = underlying at source_date               | in: 11d `source_date_price`           |      |
| 11x | 450  | API warnings are real feedback, fix before moving on | in: save/post/finalize warning output |      |
| 11y | 451  | Keep run_id explicit, no implicit context lookup     | in: 4h/4i `run_id`                    |      |


## 12 - Reply


| ID  | Line    | Rule                                               | Flow                                                    | File |
| --- | ------- | -------------------------------------------------- | ------------------------------------------------------- | ---- |
| 12a | 459     | Why the trade makes sense                          | in: 11q derivation explanation + research               |      |
| 12b | 460     | Author's words -> thesis -> instrument             | in: 11g `headline_quote` + 11f `thesis` + 11a/11b trade |      |
| 12c | 461     | 2-3 sentences                                      | in: assembled summary block                             |      |
| 12d | 463-473 | Multi-trade: portfolio framing + map               | in: all trades from one source                          |      |
| 12e | 475     | Direct trades first, then derived                  | in: 11m `trade_type`                                    |      |
| 12f | 477     | Posting fails: "Board unavailable. Skipping post." | in: post failure result                                 |      |


## 13 - Hard Rules


| ID  | Line | Rule                                  | Flow                                  | File |
| --- | ---- | ------------------------------------- | ------------------------------------- | ---- |
| 13a | 481  | Use "trades" not "recommendations"    | in: all user-facing copy              |      |
| 13b | 482  | Every number must come from a tool    | in: tool outputs (extract/route/post) |      |
| 13c | 483  | Bear theses -> short-side instruments | in: bearish thesis direction          |      |
| 13d | 484  | Flag illiquid contracts               | in: discover/route liquidity signals  |      |

