---
name: trade
description: Finds every tradeable thesis in a source and routes each to an executable trade. Works with tweets, podcasts, articles, screenshots, hunches, and market observations. Use when the user says "/trade", "trade this", "what's the trade", pastes a source and wants the trade, or states a directional belief they want translated into an expression. Stay dormant for generic market chat.
allowed-tools:
  - Bash(bun run scripts/*)
  - Bash(command -v bun)
  - Bash(command -v yt-dlp)
  - Bash(curl -fsSL https://bun.sh/install | bash)
  - Bash(git -C * pull origin main)
  - Bash(git -C * log --oneline *)
metadata:
  openclaw:
    homepage: https://paste.trade/docs/openclaw
    requires:
      bins:
        - bun
command-dispatch: tool
command-tool: trade_slash_dispatch
---

# /trade

## 0 - Intro

Think through trades live. The user is watching the work, not just the final card. Narrate what changed your mind, what has no clean expression, and why one instrument beats another.

Supporting docs: `references/` (skill index, ASCII map, CLI cheatsheet, routing decision rules, event types, trade data index, Hyperliquid thematic universe, prediction markets).

### update

If the input is exactly "update": pull the latest version of the skill repo, show what changed, and stop.

1. Find the skill repo root (the directory containing this SKILL.md).
2. Run `git -C <repo_root> pull origin main`.
3. Run `git -C <repo_root> log --oneline -5` to show recent changes.
4. Tell the user what updated (SKILL.md, scripts, references, etc.) and stop. Do not continue to the trade pipeline.

### add to source

If the input contains a paste.trade/s/ URL plus a thesis or trade idea: load `references/add-to-source.md` and follow that flow. Do not run the normal extraction pipeline.

## 1 - Defaults

- $100K risk capital, max upside
- Supported venues: Hyperliquid, Robinhood, Polymarket
- Prefer Hyperliquid when available
- Best single trade per thesis
- No em dashes in output
- End every response with: `Expressions, not advice. Do your own research.`

## 2 - Chat UX

- Keep chat updates operational and brief.
- First status line should set expectation: `Running /trade now. I will send a live link shortly.`
- For transcript sources, next status line should set duration expectation: `On it. Pulling transcript now. Longer videos can take a few minutes.`
- After `create-source.ts`, send `Watch live: {source_url}` immediately unless your runtime already delivers it.
- Continue the pipeline after the live link. Never treat the live link as the end of the `/trade` run.
- Do not wait for user input before continuing.
- If your runtime surfaces progress in chat, send updates when the state changes. Do not hold them and dump them at the end.

## Preflight

Before running any script, verify `bun` is available (`command -v bun`). If missing, install it: `curl -fsSL https://bun.sh/install | bash`, then restart the shell.

Run before every `/trade`:

```bash
bun run scripts/onboard.ts
# Returns: { status, env_path, keys, handle?, profile_url? }
```

If `status` is `"ready"`, continue to §3.

If `status` is `"onboarding"`:
- Greet the user with their handle and paste.trade profile link.
- For each key with `status: "missing"`, share the `hint` text.
- For missing items with an `install_command`, offer to run it (e.g., "Want me to install yt-dlp?").
- Do not gate on optional keys. Tell the user they can add them later and continue.
- Offer to save keys now: "Want to add any of these? You can paste each key and I'll save it to your .env."
- If the user pastes a key in reply, append `KEY=value` to the `env_path` from onboard output. Confirm what was saved and where. Never echo the full key value back in chat.
- Re-run `onboard.ts` after saving to verify the key is detected.
- Then continue to §3 with the original `/trade` input.

If `status` is `"failed"`, stop and show the error. Do not proceed without a working `PASTE_TRADE_KEY`.

## Core Loop

### 3 - Classify

- URL source: extract first.
- PDF source: read the PDF yourself (do not pass to extract.ts — it cannot parse PDFs). Use the text you read as the source artifact for thesis extraction.
- User-typed thesis: their words are the thesis. Skip extraction. Their exact input is the `headline_quote`. Do not paraphrase it. The AI interpretation goes in `thesis`.
- If URL is `paste.trade/s/:id` or `paste.trade/t/:id`, treat as normal source input.

### 4 - Extract

Primary extraction:

```bash
bun run scripts/extract.ts "URL"
# Returns: { source, word_count, saved_to, title?, published_at?, channel_handle?, description?, duration_seconds?, image_files? }
# YouTube: transcript omitted from output; read the file at saved_to.
# Tweet images: downloaded to local files listed in image_files[]. Read them for visual context.
```

Create the source page as soon as you know the source metadata:

```bash
bun run scripts/create-source.ts '{ "url": "...", "title": "...", "platform": "...", "author_handle": "...", "author_avatar_url": "...", "source_date": "...", "source_images": [...], "body_text": "...", "word_count": N, "duration_seconds": N, "speakers_count": N }'
# Returns: { source_id, source_url, status: "processing", run_id }
```

#### Execution sequence

1. Run `extract.ts`.
2. **If `image_files` are present in the output, read them now.** Charts, screenshots, and diagrams are critical source context — use them to inform thesis extraction, ticker identification, and derivation reasoning. Describe what you see.
3. If YouTube with multiple speakers with competing or independent market views (panels, debates, co-hosted roundtables — not single-guest interviews) and `GEMINI_API_KEY` is missing: ask the user now — before creating the source. Offer to paste a key or continue without speaker attribution.
4. Run `create-source.ts`. **Send the Watch live link immediately unless your runtime handles delivery, then continue the pipeline in the same run. Do not stop or wait for user input.** (See §2 Chat UX.)
5. Do NOT read the `saved_to` file before this point.
6. Only after source creation, run enrichment, transcript reads, and uploads.

#### Notes

- `author_handle` here means the source publisher/channel handle.
- YouTube uses `channel_handle`, not a guest speaker.
- `author_avatar_url` is the author's profile picture URL from extract output. Always include it — the source page and feed cards display it immediately.
- `body_text` is the **full original source text** (e.g., the complete tweet, article body). Always include it — the source page displays it verbatim.
- `word_count`, `duration_seconds`, `speakers_count` are optional extraction metadata for the live stats bar.
- Save `run_id` and thread it through every later adapter call for this source run.
- If the prompt includes internal tracing metadata (`run_id=...`), pass that value as `run_id` in the `create-source.ts` payload.
- Use the canonical live-link line from Chat UX.

Status update payload shape:

```bash
bun run scripts/status.ts <source_id> '{ "event_type": "status", "data": { "message": "..." } }'
```

### 5 - Enrich

#### Timing
Runs after the source page exists and the user has a live link. Runs before thesis extraction.

#### Metadata

- Check extraction output for missing `author_handle`, `source_date`, `title`.
- If author missing: scan extracted text for byline patterns, then web search URL/title to find author and X handle.
- If `source_date` missing: scan text for date indicators, web search, or `"now"` as last resort. For user-typed theses, always use `"now"`. Scripts resolve it to actual current time. Never guess a time like noon UTC.
- Enriched metadata is used in trade posts (source page author stays as-is).

#### Dense source enrichment
→ Read `references/dense.md` for diarization, speaker identity, and transcript handling. Sparse sources skip to §6.

- Avatars not in scope: backend auto-resolves via `ensureAuthor` + `enqueueAssetJob`.

**Push enriched metadata:**

If enrichment resolved new metadata (author handle, source date, speakers, or thumbnail), push it now so the source page updates before thesis extraction:

```bash
bun run scripts/update-source.ts <source_id> --run-id <run_id> '{ "author_handle": "...", "source_date": "...", "thumbnail_url": "...", "speakers": [...] }'
```

### 6 - Theses

#### Core
Read the canonical source artifact and find every tradeable thesis.

A thesis is a directional belief about what changes and what that means for price.

#### Extraction
- **Dense source** (podcast, article, PDF): handled by `references/dense.md` (entered at §5). Covers extraction through routing. Resume at §10 Post.
- **Sparse source** (tweet, user thesis, screenshot): → read `references/sparse.md`. Handles extraction through routing (§6-§9). Resume at §10 Post.

Both paths use the thesis schema and save commands below.

```json
{
  "thesis": "author's directional belief in one sentence, in your words not theirs",
  "horizon": "author's timing language, if any",
  "route_status": "unrouted",
  "unrouted_reason": "pending_route_check",
  "who": [
    { "ticker": "NVDA", "direction": "long" },
    { "ticker": "AI infrastructure companies", "direction": "long" }
  ],
  "why": ["reasoning step from author", { "text": "researched fact", "url": "...", "origin": "research" }],
  "quotes": ["exact words from source that anchor the thesis"],
  "headline_quote": "verbatim from quotes[], <=120 chars. Frozen at extraction, post.ts validates exact match",
  "source_date": "ISO 8601 datetime with time (e.g. 2026-03-10T14:30:00Z), or \"now\" for user-typed theses. Scripts resolve \"now\" to actual current time. Date-only resolves to midnight UTC → wrong price.",
}
```

#### Who field
`who` captures 1-3 trade ideas per thesis. These are starting points for routing, not final selections. Can range from specific tickers to broad descriptions. During routing, `who` is overwritten with the final selected expression.

A thesis is one belief. If the same belief could be traded through different instruments, those are `who` entries, not separate theses.

Include the most direct expression of the thesis alongside any specific ticker names.

For unresolved candidates, do not drop them. Save them as:

```json
{
  "thesis": "...",
  "route_status": "unrouted",
  "unrouted_reason": "no clean liquid instrument / weak directional expression / evidence gap",
  "who": [],
  "why": ["..."],
  "quotes": ["..."],
  "headline_quote": "..."
}
```

#### Save and parallel
Save all theses from extraction in one batch call (pass `--total` on first save if using individual saves instead):

```bash
# Preferred: batch save all theses at once:
echo '[{...}, {...}]' | bun run scripts/batch-save.ts --run-id <run_id> --total 5
# Returns: [{ id, index }, ...]

# Individual save (when extracting one at a time):
bun run scripts/save.ts --run-id <run_id> --total 5 '<thesis JSON>'
# Returns: { id, file, count }

# Update a saved thesis (used during routing):
echo '<partial JSON>' | bun run scripts/save.ts --run-id <run_id> --update <id>
```

Track the returned thesis IDs. You need every one for finalization.

Before starting research, narrate the transition so the live page stays active:
`bun run scripts/stream-thought.ts --run-id <run_id> "Researching market context..."`

Save and post return `{"ok": false, "error": "..."}` on validation errors (exit 0),
so parallel calls are safe -- one failure does not cancel siblings. Always check the
`ok` field (or presence of `error`) in tool output before proceeding.
Do not use routing difficulty as a filter at extraction time. Capture first, then route or explicitly mark unrouted.

### 7 - Research

Dense sources: §7-§9 are covered by `references/dense.md` (d-3 through d-8).
Sparse sources: §7-§9 are covered by `references/sparse.md`.

For each thesis, determine the best executable expression on supported venues.
On adapter error, retry the failed step once. If it fails again, try an alternative ticker or skip the thesis.

#### Venues

Supported venues:

- Hyperliquid
- Robinhood
- Polymarket

#### Parallel steps

1. **Research** (run in parallel):
   - **Web search**: verify the thesis holds today, find developments, and research
     tradeable instruments for the ideas in `who`. Your training data is stale for
     tickers and listings. Search to find what's actually available.
     Cite findings in `why` as { "text": "...", "url": "...", "origin": "research" }.
   - **Instrument discovery** (`scripts/discover.ts --query "<keywords>"`):
     search available instruments across all venues (Hyperliquid + Polymarket) using
     terms from `who`. Works best with single concrete terms, not multi-word abstractions.
     Use `--catalog` for a full listing of non-crypto HL instruments.
     For HIP-3/non-crypto results, prefer entries whose `reference_symbols` and
     `routing_note` show the same ETF, benchmark, commodity, or private company
     the thesis is really about.
   - **Source context** (`scripts/source-excerpt.ts --run-id <run_id> --file <saved_to> --query "<thesis keywords>"`):
     retrieve surrounding context from the original source for this thesis.
     After extraction splits a source into theses, adjacent details get lost.
     Use this to find what the author said around each claim: qualifications,
     supporting numbers, competitive landscape, or nuance that strengthens
     the derivation. Also use `--around "<exact quote>"` to expand a specific quote.
2. **Route** (`scripts/route.ts`): validate the best candidates
   from both sources against supported venues and get pricing. Takes ticker symbols only.
3. **Select and save**: pick the expression with the tightest link between the source
   quote and the instrument. The trade ideas in `who` are starting context, not decisions.
   Routing may confirm them, improve on them, or find something better entirely.
   Prefer sector-level instruments over single equities for broad theses.
   Persist via `save.ts --update`.

#### Venue upgrades
- **ETFs and broad-sector stocks**: Hyperliquid often has a thematic index or
  commodity perp tracking the same underlying with leverage and no ETF overhead.
  Run `discover.ts --query "<theme>"` to check. See `references/hl-universe.md`.
- **Event-driven theses**: Polymarket may have a binary contract that directly
  prices the catalyst. Run `discover.ts --query "<event keywords>"` to check.
  See `references/prediction-markets.md`.
  If discover.ts returns zero PM results for a thesis, do not route to Polymarket.
- If a better venue exists, route there and present the original as an alternative.

#### Requirements

- If a thesis is executable on both Hyperliquid and Robinhood, prefer Hyperliquid.
- If best trade is not one of the initially considered direct tickers, update
  thesis with explicit proxy reasoning and citations.
- Before final route, check quote-to-trade logic: if original author would not
  recognize the link, reroute.

#### Directness

- `direct`: original author would recognize this as their trade.
- `derived`: author did not name it, but market link is immediate and defensible.

#### Route evidence

```json
{
  "route_status": "routed",
  "who": [{ "ticker": "SMR", "direction": "short" }],
  "route_evidence": {
    "subjects": [{ "label": "NuScale Power", "subject_kind": "company" }],
    "direct_checks": [
      {
        "subject_label": "NuScale Power",
        "ticker_tested": "SMR",
        "executable": true,
        "shares_available": true,
        "author_price": 12.54
      }
    ],
    "selected_expression": {
      "ticker": "SMR",
      "direction": "short",
      "instrument": "shares",
      "platform": "robinhood",
      "trade_type": "direct",
      "author_price": 12.54
    }
  }
}
```

Mapping rule from route output:

- `route.selected_expression.routed_ticker` -> `route_evidence.selected_expression.ticker`
- keep `instrument`/`platform` strings exactly as returned (`shares`/`perps`, `robinhood`/`hyperliquid`)
- if proxy route selected, include `fallback_reason_tag` (and `fallback_reason_text` when direct executable exists)

These fields cross-reference each other. `save.ts` validates consistency:
every `subjects[].label` needs a matching `direct_checks[].subject_label`,
and the selected ticker must appear in `who`. Include updated `who`,
`route_evidence`, and `derivation` in the same `--update` call.

### 8 - Narrate

Build a derivation chain for every routed trade:

```json
{
  "explanation": "1-2 sentences that explain the trade in plain English. No em dashes.",
  "segments": [
    { "quote": "verbatim source quote", "speaker": "speaker name", "speaker_handle": "@handle", "timestamp": "14:22", "source_url": "https://..." }
  ],
  "steps": [
    { "text": "reasoning grounded in source", "segment": 0 },
    { "text": "researched fact", "url": "https://..." },
    { "text": "inference: skill's own reasoning" }
  ]
}
```

Write an `explanation` for every routed trade. Lead with the sharp insight and
explain the reasoning in 1-2 sentences. This is the short summary near the
quote; steps are the full chain.

Prefer exactly 3 steps. Each step must advance the chain, no filler. Max 70 chars per step — write like a headline, not a sentence. Cut dates, parentheticals, and asides. No em dashes. No jargon.

Steps should earn the conclusion, not summarize it. If the author named the
ticker, the chain can be short. If routing required a leap, earn it. When a
step depends on external research or a factual check, cite it with numbered
inline citations in Markdown: `[1](url)`, `[2](url)`. Include timestamps when
available.


#### Rules

- Provenance: has `segment` = sourced from quote, has `url` = backed by research, has neither = agent inference
- when a step depends on external research or a factual check, embed the source inline as numbered Markdown citations: `[1](url)`, `[2](url)`; treat this as part of the format, not decoration
- `url` on a step is a fallback when numbered inline linking does not fit
- be honest when a step is your own inference
- user thesis: their words are the segment, `speaker: "user"`
- video/podcast: every segment MUST include `timestamp` (MM:SS or H:MM:SS from diarized transcript) and `source_url` (the video URL). These power click-to-seek on the source page. Resolve speaker X handles when it materially helps attribution.
- tweets: `timestamp` and `source_url` can be omitted (no timestamp concept for tweets)

### 9 - Price

#### Instrument preference

- Direct thesis subject on Hyperliquid → perps
- ETF tickers → run `discover.ts --query "TICKER"` to check for an HL perp on the same underlying. Route the HL perp, not the ETF.
- Sector/commodity/index thesis with an HL thematic equivalent → HL perps
  (not when the author named a specific company; their thesis is the company, not the sector)
- PM contract that prices the event/catalyst → post as separate thesis alongside price trade.
  PM is additive, not competing. Skip only when no relevant contract exists.
- Otherwise direct thesis subject via shares
- If no direct executable route, use the best proxy

#### Pricing

```bash
bun run scripts/route.ts --run-id <run_id> --thesis-id <id> TICKER direction --source-date "ISO-8601-datetime-or-YYYY-MM-DD" --horizon "timing"
# Returns: { tool: "route", route: { ticker, direction, executable, selected_expression, alternatives, price_context, candidate_routes, note }, diagnostics }
# selected_expression and candidate_routes include HIP-3 routing metadata (see routing.md).
# price_context: { current_price, source_date, author_price }
# If perps route selected and routed_ticker is provided, post that routed_ticker as ticker.
```

Use tool numbers directly. Do not estimate or recompute.

After routing completes for a thesis, persist everything in one update: `who` (updated to final ticker), `route_status`, `route_evidence`, and `derivation` together:

```bash
echo '<JSON with who + route_evidence + derivation>' | bun run scripts/save.ts --run-id <run_id> --update <id>
```

This emits `thesis_routed` (or `thesis_dropped`) events automatically, updating the live source page with derivation data as each thesis resolves.

### 10 - Post

Post each trade:

```bash
echo '<JSON payload>' | bun run scripts/post.ts --run-id <run_id>
```

#### Post rules

- `headline_quote` must be an exact string match to one of saved `quotes[]`.
- Posted `ticker`, `direction`, `instrument`, `platform`, and `trade_type` must match `route_evidence.selected_expression`.
- Carry `author_price` from route `price_context` whenever present.
- `post.ts` will attempt baseline enrichment via `/api/skill/assess` if `author_price` is missing, but treat that as fallback not primary path.

After all trade POSTs succeed, finalize the source explicitly:

```bash
echo '{ "source_id": "...", "source_theses": [...], "source_summary": "...", "message": "All trades posted" }' | bun run scripts/finalize-source.ts --run-id <run_id>
```

#### Finalization

- `source_id`: source page being completed
- `source_theses`: all extracted theses, routed and unrouted
- each `source_theses` entry must carry `thesis_id` (or `id`) from `save.ts`
- each routed `source_theses` entry must include non-empty `who`
- each unrouted `source_theses` entry must include non-empty `unrouted_reason`
- every extracted thesis must appear exactly once in `source_theses` (no drops, no duplicates)
- `source_summary`: one-line summary of the whole source, especially important for grouped sources like timelines
- `message`: optional completion message

Do not rely on a trade POST to resolve the live source page.

## 11 - Contract

### Required fields

| Field | Notes |
|-------|-------|
| `ticker` | Use `routed_ticker` value from route output. Post as `ticker`, not as `routed_ticker` |
| `direction` | `"long"` or `"short"` |
| `author_price` | Price at author's publish date. Use route `price_context.author_price` |
| `thesis` | Thesis text |
| `headline_quote` | Must exactly match one saved `quotes[]` value and be <=120 chars |
| `ticker_context` | 1-3 sentences that explain the instrument to someone who doesn't know what it is. No jargon. |
| `author_handle` | Speaker/author whose quote anchors this trade; user thesis -> current authenticated user handle |
| `author_platform` | `"youtube"`, `"x"`, `"substack"`, `"podcast"`, `"pdf"`, `"direct"`, etc. |
| `source_url` | string or null |
| `author_date` | ISO 8601 — when the author said it |
| `trade_type` | `"direct"` or `"derived"` |
| `instrument` | `"shares"` or `"perps"` |
| `platform` | `"robinhood"` or `"hyperliquid"` |
| `thesis_id` | ID from `save.ts` |
| `derivation` | `{ explanation, segments, steps }` where `explanation` is the 1-2 sentence summary and `steps` are the main chain. |

### Source fields

- `source_title`: title/headline when the source has one
- `source_images`: image URLs extracted from the source

Finalization-only fields:

- `source_theses`: all theses from this source, passed to `finalize-source.ts`
- `source_summary`: one-line source summary, passed to `finalize-source.ts`

Useful optional `trade_data` fields:

- `horizon`
- `alt_venues`
- `avatar_url`

For Polymarket trades, also include:

- `outcome`: `"yes"` or `"no"` — canonical field for which token was bought
- `pm_side`: `"yes"` or `"no"` — legacy compatibility alias for `outcome`
- `pm_yes_no_price`: raw YES price in the 0-1 range

### Notes

- Card price is the canonical entry price at `author_date`
- For Polymarket, that means the held-side token price: YES price for YES trades, NO price for NO trades
- API warnings are real feedback; notice them and fix obvious quality problems before moving on
- Keep `run_id` explicit throughout the run. Do not rely on implicit context lookup.

## 12 - Reply

When done, reply in one block.

- why the trade makes sense
- author's words -> thesis -> instrument
- 2-3 sentences

When 3+ trades come from one source, open with 1-2 sentences framing the portfolio logic, then map them:

```text
[N] trades from @[handle]'s [source type]:

"headline quote" -> TICKER direction
"headline quote" -> TICKER direction
...

-> Reply to dig deeper
```

If both direct and derived trades exist, show direct first.

Do not include trade card URLs (paste.trade/t/...) in the reply — they are already linked from the live board. Only include the live board URL (paste.trade/s/...) if it hasn't been shared yet.

If posting fails: `Board unavailable. Skipping post.`

## 13 - Hard Rules

1. Use "trades" and "market data", never "recommendations" or "advice"
2. Every number must come from a tool
3. Bear theses -> short-side instruments
4. Flag illiquid contracts
