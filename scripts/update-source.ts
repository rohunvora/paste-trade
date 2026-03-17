#!/usr/bin/env bun
/**
 * Push enriched source metadata to the source page.
 *
 * Usage:
 *   bun run skill/scripts/update-source.ts <source_id> --run-id <run_id> '{ "author_handle": "...", "source_date": "...", "thumbnail_url": "..." }'
 *   echo '{ ... }' | bun run skill/scripts/update-source.ts <source_id> --run-id <run_id>
 */

import { applyRunId, extractRunIdArg } from "./run-id";
import { pushEvent } from "./stream-context";
import { readJsonInput } from "./common";

const { runId, args } = extractRunIdArg(process.argv);
applyRunId(runId);

const sourceId = args[0];
if (!sourceId) {
  console.error("Usage: bun run skill/scripts/update-source.ts <source_id> --run-id <run_id> '<JSON>'");
  process.exit(1);
}

const payload: Record<string, unknown> = await readJsonInput(args[1]);

// Allowlist of updatable fields
const ALLOWED_FIELDS = ["author_handle", "author_avatar_url", "source_date", "published_at", "title", "thumbnail_url", "summary", "body_text", "speakers"] as const;
const filtered: Record<string, unknown> = {};
const fields: string[] = [];
for (const key of ALLOWED_FIELDS) {
  if (key in payload && payload[key] != null) {
    filtered[key] = payload[key];
    fields.push(key);
  }
}

if (fields.length === 0) {
  console.log(JSON.stringify({ ok: true, updated: false, reason: "No recognized fields in payload" }));
  process.exit(0);
}

const ok = await pushEvent(sourceId, "source_updated", {
  ...filtered,
  fields,
}, { runId });

if (!ok) {
  console.error("[update-source] Failed to push source_updated event");
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, source_id: sourceId, fields }));
