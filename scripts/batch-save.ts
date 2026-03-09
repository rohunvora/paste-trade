#!/usr/bin/env bun
/**
 * Batch thesis save — saves an array of theses in one call.
 * Pushes thesis_found events with staggered delays for progressive reveal.
 *
 * Usage:
 *   echo '[{thesis1}, {thesis2}, ...]' | bun run skill/scripts/batch-save.ts
 *
 * Returns: [{ "id": "be5378b3", "index": 0 }, { "id": "a91c44d2", "index": 1 }, ...]
 *
 * All-or-nothing: if any thesis fails validation, the entire batch fails.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { normalizeRouteStatus, validate, type ThesisObject } from "./validate";
import { applyRunId, extractRunIdArg } from "./run-id";
import { appendTraceEvent, hashForTrace } from "./trace-audit";
import { countRunExtractions } from "./run-count";
import { getRuntimeExtractionDir } from "./runtime-paths";

const EXTRACTION_DIR = getRuntimeExtractionDir();
const STAGGER_MS = 800;
const { runId } = extractRunIdArg(process.argv);
applyRunId(runId);

async function main() {
  // Read array from stdin
  const raw = await Bun.stdin.text();
  if (!raw?.trim()) {
    console.log(JSON.stringify({ error: "No input. Pipe a JSON array of thesis objects via stdin." }));
    process.exit(1);
  }

  let theses: unknown[];
  try {
    const parsed = JSON.parse(raw.trim());
    if (!Array.isArray(parsed)) {
      console.log(JSON.stringify({ error: "Input must be a JSON array of thesis objects." }));
      process.exit(1);
    }
    theses = parsed;
  } catch {
    console.log(JSON.stringify({ error: "Invalid JSON", detail: raw.slice(0, 200) }));
    process.exit(1);
  }

  if (theses.length === 0) {
    console.log(JSON.stringify({ error: "Empty array — nothing to save." }));
    process.exit(1);
  }

  // Validate ALL theses before saving any
  const allErrors: { index: number; errors: string[] }[] = [];
  for (let i = 0; i < theses.length; i++) {
    const { valid, errors } = validate(theses[i]);
    if (!valid) allErrors.push({ index: i, errors });
  }

  if (allErrors.length > 0) {
    console.log(JSON.stringify({ error: "Validation failed", failures: allErrors }));
    process.exit(1);
  }

  // Ensure extraction directory exists
  if (!existsSync(EXTRACTION_DIR)) {
    mkdirSync(EXTRACTION_DIR, { recursive: true });
  }

  // Build all records and append in one write
  const dateStr = new Date().toISOString().slice(0, 10);
  const file = process.env.EXTRACTION_FILE || `${EXTRACTION_DIR}/extraction-${dateStr}.jsonl`;
  const existing = existsSync(file) ? await Bun.file(file).text() : "";
  const existingCount = existing.trim() ? existing.trim().split("\n").length : 0;

  const results: { id: string; index: number }[] = [];
  const newLines: string[] = [];

  for (let i = 0; i < theses.length; i++) {
    const id = randomUUID().slice(0, 8);
    const record = {
      id,
      timestamp: new Date().toISOString(),
      run_id: runId ?? undefined,
      ...(theses[i] as ThesisObject),
    };
    newLines.push(JSON.stringify(record));
    results.push({ id, index: i });
  }

  // Single write — all theses appended at once
  await Bun.write(file, existing + newLines.join("\n") + "\n");

  let routedCount = 0;
  let unroutedCount = 0;
  for (const thesis of theses) {
    const status = normalizeRouteStatus(thesis as Record<string, unknown>);
    if (status === "routed") routedCount += 1;
    if (status === "unrouted") unroutedCount += 1;
  }

  const fileCount = existingCount + theses.length;
  const runCount = await countRunExtractions(runId);

  appendTraceEvent({
    type: "trade_run_extraction_batch_saved",
    runIdHash: runId ? hashForTrace(runId) : null,
    batchSize: theses.length,
    extractionCount: runCount ?? fileCount,
    fileCount,
    routedCount,
    unroutedCount,
  });

  // Output results immediately so the model can continue
  console.log(JSON.stringify(results));

  // Push thesis_found events with staggered delays for progressive reveal
  try {
    const { getStreamContext, incrementThesisCount, pushEvent } = await import("./stream-context");
    const ctx = getStreamContext(runId);
    if (ctx) {
      for (let i = 0; i < theses.length; i++) {
        const thesis = theses[i] as ThesisObject;
        const sessionCount = incrementThesisCount(runId);
        const routeStatus = normalizeRouteStatus(thesis as Record<string, unknown>);

        // Stagger: wait before each event (except the first)
        if (i > 0) await new Promise(r => setTimeout(r, STAGGER_MS));

        await pushEvent(ctx.source_id, "thesis_found", {
          message: thesis.thesis,
          thesis_id: results[i].id,
          thesis: thesis.thesis,
          headline_quote: thesis.headline_quote,
          who: Array.isArray(thesis.who) ? thesis.who : [],
          route_status: routeStatus ?? undefined,
          unrouted_reason: typeof thesis.unrouted_reason === "string" ? thesis.unrouted_reason : undefined,
          progress: sessionCount,
        }, { runId });
      }
    }
  } catch { /* streaming is optional */ }
}

main().catch((e) => {
  console.log(JSON.stringify({ error: "Unexpected error", detail: String(e) }));
  process.exit(1);
});
