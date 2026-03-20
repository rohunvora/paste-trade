# Add trade to existing source

Use this flow when the user provides a paste.trade source URL and wants to add a new trade to it.

Triggers: paste.trade/s/ URL + a thesis, or user says "add [thesis] to [source]".

## Steps

1. **Extract source_id** from the URL. The source_id is the path after `/s/` (e.g., `paste.trade/s/900d9306-8` → `900d9306-8`).

2. **Fetch existing trades** to avoid duplicates and understand what's already been routed:

```bash
curl -s "https://paste.trade/api/sources/<source_id>" \
  -H "Authorization: Bearer $PASTE_TRADE_KEY"
```

This returns the source and all its trades. Check the tickers and theses already posted.

3. **Run the normal pipeline (§7-§10) for the new thesis only.** Skip §3-§6 (source already exists, no extraction needed). The user is giving you the thesis directly.

   - Research instruments (§7)
   - Narrate derivation (§8)
   - Price (§9)
   - Post (§10)

4. **Post with `source_id`** so the trade attaches to the existing source. Add `"source_id": "<source_id>"` to the post.ts payload. The trade will appear on the same source page.

```bash
echo '<payload with source_id>' | bun run skill/scripts/post.ts --run-id <run_id>
```

## What to skip

- Do NOT run `create-source.ts` (source already exists)
- Do NOT run `extract.ts` (no URL to extract from)
- Do NOT run `save.ts` or `batch-save.ts` (no extraction record to save to)
- Do NOT send a "Watch live" link (source page already exists)

## Dedup

Before routing, check the existing trades on the source. If the same ticker + direction already exists, tell the user and ask if they want a second position or meant something different.

## Post payload

Same shape as §10, but:
- `source_id` is required (from step 1)
- `thesis_id` is omitted (no saved extraction record)
- `source_url` can be omitted (source already knows its URL)
- All other fields (ticker, direction, instrument, platform, derivation, etc.) are the same as normal posts
