/**
 * Explicitly finalize a source processing run.
 *
 * Usage:
 *   echo '{ "source_id": "...", "source_theses": [...], "source_summary": "...", "message": "All trades posted" }' | bun run skill/scripts/finalize-source.ts --run-id <runId>
 *   bun run skill/scripts/finalize-source.ts --run-id <runId> '{ "source_id": "...", "source_theses": [...] }'
 */

import { existsSync } from "fs";
import { applyRunId, extractRunIdArg } from "./run-id";
import { clearStreamContext, pushEvent } from "./stream-context";
import { appendTraceEvent, hashForTrace } from "./trace-audit";
import { normalizeRouteStatus } from "./validate";
import { getRuntimeExtractionDir } from "./runtime-paths";

const EXTRACTION_DIR = getRuntimeExtractionDir();

interface SavedExtractionRecord {
  id: string;
  thesis?: string;
  headline_quote?: string;
  run_id?: string;
}

function resolveThesisRef(entry: Record<string, unknown>): string | null {
  const thesisId = typeof entry.thesis_id === "string" ? entry.thesis_id.trim() : "";
  if (thesisId) return thesisId;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  return id || null;
}

function summarizeRecord(record: SavedExtractionRecord): string {
  const headline = typeof record.headline_quote === "string" ? record.headline_quote.trim() : "";
  if (headline) return headline;
  const thesis = typeof record.thesis === "string" ? record.thesis.trim() : "";
  return thesis.slice(0, 120) || "<no thesis text>";
}

async function loadRunExtractionRecords(runId: string): Promise<SavedExtractionRecord[]> {
  if (!runId || !existsSync(EXTRACTION_DIR)) return [];
  const files = (await Array.fromAsync(new Bun.Glob("extraction-*.jsonl").scan(EXTRACTION_DIR)))
    .map((file) => `${EXTRACTION_DIR}/${file}`)
    .sort();
  const records: SavedExtractionRecord[] = [];
  for (const file of files) {
    const content = await Bun.file(file).text();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as SavedExtractionRecord;
        if (parsed.run_id === runId && typeof parsed.id === "string" && parsed.id.trim()) {
          records.push(parsed);
        }
      } catch {
        // Skip malformed JSONL lines.
      }
    }
  }
  return records;
}

const { runId, args } = extractRunIdArg(process.argv);
applyRunId(runId);

let payload = args[0];
if (!payload) payload = await Bun.stdin.text();
if (!payload?.trim()) {
  console.error("Usage: bun run skill/scripts/finalize-source.ts --run-id <runId> '<JSON payload>' (or pipe via stdin)");
  process.exit(1);
}

let body: any;
try {
  body = JSON.parse(payload.trim());
} catch {
  console.error(`[finalize-source] Invalid JSON payload: ${payload.slice(0, 200)}`);
  process.exit(1);
}

if (!body.source_id || typeof body.source_id !== "string") {
  console.error("[finalize-source] source_id is required");
  process.exit(1);
}
if (!body.source_theses || !Array.isArray(body.source_theses)) {
  console.error("[finalize-source] source_theses array is required");
  process.exit(1);
}
if (!runId) {
  console.error("[finalize-source] --run-id is required for finalization accounting");
  process.exit(1);
}

const extracted = await loadRunExtractionRecords(runId);
const extractedById = new Map<string, SavedExtractionRecord>();
for (const item of extracted) extractedById.set(item.id, item);
const extractedIds = new Set(extractedById.keys());
const accountedIds = new Set<string>();
const errors: string[] = [];
let routedCount = 0;
let unroutedCount = 0;

if (extractedIds.size === 0) {
  errors.push(`No extracted theses found for run_id=${runId}`);
}

for (let i = 0; i < body.source_theses.length; i++) {
  const rawEntry = body.source_theses[i];
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
    errors.push(`source_theses[${i}] must be an object`);
    continue;
  }
  const entry = rawEntry as Record<string, unknown>;
  const routeStatus = normalizeRouteStatus(entry);
  if (!routeStatus) {
    errors.push(`source_theses[${i}] missing route decision (route_status or routed)`);
  } else if (routeStatus === "routed") {
    routedCount += 1;
    if (!Array.isArray(entry.who) || entry.who.length === 0) {
      errors.push(`source_theses[${i}] routed thesis must include non-empty who array`);
    }
  } else if (routeStatus === "unrouted") {
    unroutedCount += 1;
    if (typeof entry.unrouted_reason !== "string" || !entry.unrouted_reason.trim()) {
      errors.push(`source_theses[${i}] unrouted thesis must include unrouted_reason`);
    }
  }

  const ref = resolveThesisRef(entry);
  if (!ref) {
    errors.push(`source_theses[${i}] must include thesis_id (or id) to preserve extraction accounting`);
    continue;
  }
  if (!extractedIds.has(ref)) {
    errors.push(`source_theses[${i}] references unknown thesis_id=${ref}`);
    continue;
  }
  if (accountedIds.has(ref)) {
    errors.push(`source_theses contains duplicate thesis_id=${ref}`);
    continue;
  }
  accountedIds.add(ref);
}

for (const id of extractedIds) {
  if (!accountedIds.has(id)) {
    const record = extractedById.get(id)!;
    errors.push(`Missing extracted thesis_id=${id} in source_theses (${summarizeRecord(record)})`);
  }
}

if (body.source_theses.length !== extractedIds.size) {
  errors.push(
    `source_theses count (${body.source_theses.length}) must match extracted thesis count (${extractedIds.size})`,
  );
}

if (errors.length > 0) {
  appendTraceEvent({
    type: "trade_run_finalize_rejected",
    runIdHash: hashForTrace(runId),
    sourceIdHash: hashForTrace(body.source_id),
    extractedCount: extractedIds.size,
    providedCount: body.source_theses.length,
    errorsCount: errors.length,
    firstError: errors[0] ?? null,
    errorsPreview: errors.slice(0, 3),
  });
  for (const error of errors) {
    console.error(`[finalize-source] ${error}`);
  }
  process.exit(1);
}

appendTraceEvent({
  type: "trade_run_finalize_ready",
  runIdHash: hashForTrace(runId),
  sourceIdHash: hashForTrace(body.source_id),
  extractedCount: extractedIds.size,
  routedCount,
  unroutedCount,
  completionMessageLength: typeof body.message === "string" ? body.message.length : 0,
});

// Emit done event (v2 only — backend handles both done and complete identically)
const ok = await pushEvent(body.source_id, "done", {
  message: body.message ?? "All trades posted",
  source_theses: body.source_theses,
  source_summary: typeof body.source_summary === "string" ? body.source_summary : undefined,
  theses_count: body.source_theses.length,
  routed_count: routedCount,
  unrouted_count: unroutedCount,
}, { runId });

if (!ok) {
  appendTraceEvent({
    type: "trade_run_finalize_failed",
    runIdHash: hashForTrace(runId),
    sourceIdHash: hashForTrace(body.source_id),
    extractedCount: extractedIds.size,
    routedCount,
    unroutedCount,
  });
  console.error("[finalize-source] Failed to emit complete event");
  process.exit(1);
}

appendTraceEvent({
  type: "trade_run_finalize_emitted",
  runIdHash: hashForTrace(runId),
  sourceIdHash: hashForTrace(body.source_id),
  extractedCount: extractedIds.size,
  routedCount,
  unroutedCount,
});

clearStreamContext(runId);
console.log(
  JSON.stringify({
    ok: true,
    source_id: body.source_id,
    finalized: true,
    theses_count: body.source_theses.length,
    routed_count: routedCount,
    unrouted_count: unroutedCount,
  }),
);
