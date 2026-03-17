#!/usr/bin/env bun
/**
 * Extraction Store — saves and updates thesis objects.
 *
 * Save (extraction): appends new thesis to JSONL.
 *   bun run skill/scripts/save.ts '<thesis JSON>'
 *   cat thesis.json | bun run skill/scripts/save.ts --stdin
 *
 * Update (routing): merges new fields into existing record by ID.
 *   bun run skill/scripts/save.ts --update <id> '<partial JSON>'
 *   Merges top-level fields. Nested objects are shallow-merged.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { normalizeRouteStatus, validate, type ThesisObject } from "./validate";
import { applyRunId, extractRunIdArg } from "./run-id";
import { appendTraceEvent, hashForTrace } from "./trace-audit";
import { countRunExtractions } from "./run-count";
import { getRuntimeExtractionDir } from "./runtime-paths";

const EXTRACTION_DIR = getRuntimeExtractionDir();
const { runId, args: rawArgs } = extractRunIdArg(process.argv);
applyRunId(runId);

// Parse --total flag (initial save only — tells how many theses to expect)
let totalTheses: number | undefined;
const totalIdx = rawArgs.indexOf("--total");
if (totalIdx !== -1 && rawArgs[totalIdx + 1]) {
  totalTheses = parseInt(rawArgs[totalIdx + 1], 10);
  if (!Number.isFinite(totalTheses) || totalTheses < 1) totalTheses = undefined;
  rawArgs.splice(totalIdx, 2);
}
const args = rawArgs;

async function findFileForId(id: string): Promise<string | null> {
  if (!existsSync(EXTRACTION_DIR)) return null;
  const files = (await Array.fromAsync(new Bun.Glob("extraction-*.jsonl").scan(EXTRACTION_DIR)))
    .map(f => `${EXTRACTION_DIR}/${f}`)
    .sort()
    .reverse(); // most recent first
  for (const file of files) {
    const content = await Bun.file(file).text();
    for (const line of content.trim().split("\n")) {
      try {
        const record = JSON.parse(line);
        if (record.id === id) return file;
      } catch { /* skip malformed lines */ }
    }
  }
  return null;
}

async function updateRecord(id: string, partial: Record<string, unknown>): Promise<void> {
  const file = await findFileForId(id);
  if (!file) {
    console.log(JSON.stringify({ ok: false, error: `Record ${id} not found` }));
    process.exit(0);
  }

  const content = await Bun.file(file).text();
  const lines = content.trim().split("\n");
  let found = false;
  let mergedRecord: Record<string, unknown> | null = null;

  const updated = lines.map(line => {
    try {
      const record = JSON.parse(line);
      if (record.id === id) {
        found = true;
        // Shallow merge: top-level fields replaced, nested objects merged one level deep
        const merged = { ...record };
        for (const [key, value] of Object.entries(partial)) {
          if (value && typeof value === "object" && !Array.isArray(value) &&
              merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])) {
            merged[key] = { ...merged[key], ...value };
          } else {
            merged[key] = value;
          }
        }
        merged.updated_at = new Date().toISOString();
        mergedRecord = merged as Record<string, unknown>;
        return JSON.stringify(merged);
      }
      return line;
    } catch {
      return line;
    }
  });

  if (!found) {
    console.log(JSON.stringify({ ok: false, error: `Record ${id} not found in ${file}` }));
    process.exit(0);
  }

  if (!mergedRecord) {
    console.log(JSON.stringify({ ok: false, error: `Record ${id} merge failed` }));
    process.exit(0);
  }

  const updatedKeys = new Set(Object.keys(partial));
  const touchesRouteDecision =
    updatedKeys.has("route_status") ||
    updatedKeys.has("routed") ||
    updatedKeys.has("who") ||
    updatedKeys.has("route_evidence");
  const hasRouteEvidence = Boolean(
    mergedRecord.route_evidence &&
    typeof mergedRecord.route_evidence === "object" &&
    !Array.isArray(mergedRecord.route_evidence),
  );
  const requireRouteEvidence = touchesRouteDecision || hasRouteEvidence;

  const { valid, errors } = validate(mergedRecord, { requireRouteEvidence });
  if (!valid) {
    console.log(JSON.stringify({ ok: false, error: "Schema validation failed", errors }));
    process.exit(0);
  }

  await Bun.write(file, updated.join("\n") + "\n");
  appendTraceEvent({
    type: "trade_run_extraction_updated",
    runIdHash: runId ? hashForTrace(runId) : null,
    thesisId: id,
    updatedKeys: [...updatedKeys],
  });
  console.log(JSON.stringify({ id, file, updated: true }));

  // Emit thesis lifecycle events on route status change
  try {
    const { getStreamContext, pushEvent } = await import("./stream-context");
    const ctx = getStreamContext(runId);
    if (ctx) {
      const routeStatus = typeof mergedRecord.route_status === "string"
        ? mergedRecord.route_status.trim().toLowerCase()
        : "";

      if (routeStatus === "routed") {
        // Extract derivation fields for the event
        const routeEvidence = mergedRecord.route_evidence as Record<string, unknown> | undefined;
        const selectedExpr = routeEvidence?.selected_expression as Record<string, unknown> | undefined;
        const derivation = mergedRecord.derivation as Record<string, unknown> | undefined;

        await pushEvent(ctx.source_id, "thesis_routed", {
          thesis_id: id,
          ticker: selectedExpr?.ticker ?? null,
          direction: selectedExpr?.direction ?? null,
          instrument: selectedExpr?.instrument ?? null,
          platform: selectedExpr?.platform ?? null,
          author_price: selectedExpr?.author_price ?? null,
          explanation: derivation?.explanation ?? null,
        }, { runId });
      } else if (routeStatus === "unrouted") {
        const reason = typeof mergedRecord.unrouted_reason === "string"
          ? mergedRecord.unrouted_reason.trim()
          : "";
        // Only emit thesis_dropped for final unrouted decisions, not pending_route_check
        if (reason && reason !== "pending_route_check") {
          await pushEvent(ctx.source_id, "thesis_dropped", {
            thesis_id: id,
            reason,
          }, { runId });
        }
      }
    }
  } catch (e) { console.error("[save] streaming event failed:", e); }
}

async function main() {
  // Handle --update mode
  if (args[0] === "--update") {
    const id = args[1];
    let raw = args[2];
    if (!id) {
      console.log(JSON.stringify({ error: "Usage: save.ts [--run-id <runId>] --update <id> '<partial JSON>'" }));
      process.exit(1);
    }
    if (!raw || raw === "--stdin") raw = await Bun.stdin.text();
    if (!raw?.trim()) {
      console.log(JSON.stringify({ ok: false, error: "No update data provided" }));
      process.exit(0);
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      console.log(JSON.stringify({ ok: false, error: "Invalid JSON", detail: raw.slice(0, 200) }));
      process.exit(0);
    }
    return updateRecord(id, parsed);
  }

  // Read input from arg or stdin
  const explicitStdin = args[0] === "--stdin";
  let raw = explicitStdin ? undefined : args[0];
  if (!raw) {
    raw = await Bun.stdin.text();
  }
  if (!raw?.trim()) {
    console.log(JSON.stringify({ ok: false, error: "No input provided. Pass thesis JSON as argument or pipe to stdin." }));
    process.exit(0);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    console.log(JSON.stringify({ ok: false, error: "Invalid JSON", detail: raw.slice(0, 200) }));
    process.exit(0);
  }

  const { valid, errors } = validate(parsed);
  if (!valid) {
    console.log(JSON.stringify({ ok: false, error: "Schema validation failed", errors }));
    process.exit(0);
  }

  // Ensure extraction directory exists
  if (!existsSync(EXTRACTION_DIR)) {
    mkdirSync(EXTRACTION_DIR, { recursive: true });
  }

  // Determine file: use today's date as default, or EXTRACTION_FILE env
  const dateStr = new Date().toISOString().slice(0, 10);
  const file = process.env.EXTRACTION_FILE || `${EXTRACTION_DIR}/extraction-${dateStr}.jsonl`;

  const id = randomUUID().slice(0, 8);
  const thesis = parsed as ThesisObject;
  const routeStatus = normalizeRouteStatus(thesis as Record<string, unknown>);
  const record = {
    id,
    timestamp: new Date().toISOString(),
    run_id: runId ?? undefined,
    ...thesis,
  };

  // Append to JSONL
  const line = JSON.stringify(record) + "\n";
  await Bun.write(file, (existsSync(file) ? await Bun.file(file).text() : "") + line);

  // Count lines
  const content = await Bun.file(file).text();
  const count = content.trim().split("\n").length;
  const runCount = await countRunExtractions(runId);

  appendTraceEvent({
    type: "trade_run_extraction_saved",
    runIdHash: runId ? hashForTrace(runId) : null,
    thesisId: id,
    routeStatus: routeStatus ?? null,
    extractionCount: runCount ?? count,
    fileCount: count,
  });

  console.log(JSON.stringify({ id, file, count, run_count: runCount ?? undefined }));

  // Auto-push thesis_saved event (v2 only — frontend maps v1 thesis_found → thesis_saved)
  try {
    const { getStreamContext, incrementThesisCount, pushEvent } = await import("./stream-context");
    const ctx = getStreamContext(runId);
    if (ctx) {
      const sessionCount = incrementThesisCount(runId);
      await pushEvent(ctx.source_id, "thesis_saved", {
        message: thesis.thesis,
        thesis_id: id,
        thesis: thesis.thesis,
        headline_quote: thesis.headline_quote,
        who: Array.isArray(thesis.who) ? thesis.who : [],
        route_status: routeStatus ?? undefined,
        unrouted_reason: typeof thesis.unrouted_reason === "string" ? thesis.unrouted_reason : undefined,
        progress: sessionCount,
        total: totalTheses ?? undefined,
      }, { runId });
    }
  } catch { /* streaming is optional */ }
}

main().catch((e) => {
  console.log(JSON.stringify({ error: "Unexpected error", detail: String(e) }));
  process.exit(1);
});
