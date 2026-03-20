/**
 * Create a source page on paste.trade before trades are posted.
 * Returns the source_id and source_url for live processing.
 *
 * Usage:
 *   bun run skill/scripts/create-source.ts '<JSON payload>'
 *
 * Payload: { url, title, platform, source_date, author_handle, source_images,
 *           word_count?, duration_seconds?, speakers_count? }
 * author_handle should be the source publisher/channel handle, not a guest speaker.
 * word_count, duration_seconds, speakers_count are extraction metadata —
 * stripped before the API call, used to emit an extraction_complete event.
 * Returns: { source_id, source_url, status: "processing", run_id }
 */

const payload = process.argv[2];
if (!payload) {
  console.error("Usage: bun run skill/scripts/create-source.ts '<JSON payload>'");
  process.exit(1);
}

let parsedPayload: any;
try {
  parsedPayload = JSON.parse(payload);
} catch {
  console.error(`[create-source] Invalid JSON payload: ${payload.slice(0, 200)}`);
  process.exit(1);
}

import { resolveNowSentinel } from "../shared/trade-pricing";
const resolved = resolveNowSentinel(parsedPayload.source_date);
if (resolved !== parsedPayload.source_date) {
  parsedPayload.source_date = resolved;
  console.error(`[create-source] Resolved source_date "now" → ${resolved}`);
}

// run_id: passed through to the API so the backend can use it as the trade_run ID.
// This keeps the wrapper's tracing ID and the backend's run ID in sync.
const providedRunId = typeof parsedPayload.run_id === "string" ? parsedPayload.run_id.trim() : "";
if (providedRunId && providedRunId.length > 64) {
  console.error(`[create-source] run_id too long (${providedRunId.length}). Max 64.`);
  process.exit(1);
}

const extractionMeta = {
  word_count: parsedPayload.word_count,
  duration_seconds: parsedPayload.duration_seconds,
  speakers_count: parsedPayload.speakers_count,
};
delete parsedPayload.word_count;
delete parsedPayload.duration_seconds;
delete parsedPayload.speakers_count;
const apiBody = JSON.stringify(parsedPayload);

// Auto-provision API key if missing, resolve base URL
import { ensureKey, getBaseUrl } from "./ensure-key";
import { openUrlInBrowser } from "./security";
const baseUrl = getBaseUrl();
const apiKey = await ensureKey();
if (!apiKey) {
  console.error("[create-source] No API key — source will not be attributed. Run failed.");
  process.exit(1);
}
console.error(`[create-source] POST to ${baseUrl}/api/sources`);

const headers: Record<string, string> = { "Content-Type": "application/json" };
headers["Authorization"] = `Bearer ${apiKey}`;

const res = await fetch(`${baseUrl}/api/sources`, {
  method: "POST",
  headers,
  body: apiBody,
});

const text = await res.text();
if (!res.ok) {
  console.error(`[create-source] Failed (${res.status}): ${text}`);
  process.exit(1);
}

// Write stream context so other adapters (save.ts, post.ts, route.ts)
// can automatically push live status events to the source page.
// Each run gets a unique UUID to prevent parallel-run context corruption.
try {
  const result = JSON.parse(text);
  const { writeStreamContext, pushEvent, cleanupStaleContextFiles } = await import("./stream-context");
  const { appendTraceEvent, hashForTrace } = await import("./trace-audit");

  // Clean up any stale context files from crashed/abandoned runs (>20min old)
  const cleaned = cleanupStaleContextFiles();
  if (cleaned > 0) console.error(`[create-source] Cleaned ${cleaned} stale context file(s)`);

  // Use the backend's run_id (canonical, exists in trade_runs table).
  // Falls back to the wrapper's provided ID or a random UUID.
  const runId = result.run_id || providedRunId || crypto.randomUUID().slice(0, 12);
  writeStreamContext({
    source_id: result.source_id,
    source_url: result.source_url,
    created_at: new Date().toISOString(),
    run_id: runId,
  });
  console.error(`[create-source] Run ID: ${runId}`);
  appendTraceEvent({
    type: "trade_run_created_source",
    runIdHash: hashForTrace(runId),
    sourceIdHash: hashForTrace(result.source_id),
    sourceUrlHash: typeof result.source_url === "string" ? hashForTrace(result.source_url) : null,
  });

  // Push initial status event so the viewer sees something immediately
  await pushEvent(result.source_id, "status", { message: "Processing started..." }, { runId });

  // Emit extraction_complete if we have extraction metadata (populates ExtractionStats bar)
  if (extractionMeta.word_count || extractionMeta.duration_seconds || extractionMeta.speakers_count) {
    await pushEvent(result.source_id, "extraction_complete", {
      message: "Extraction complete",
      word_count: extractionMeta.word_count ?? undefined,
      duration_seconds: extractionMeta.duration_seconds ?? undefined,
      speakers_count: extractionMeta.speakers_count ?? undefined,
    }, { runId });
  }

  // Open the live page in the user's browser automatically
  await openUrlInBrowser(result.source_url, new URL(baseUrl).hostname);

  result.run_id = runId;
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  // Non-fatal — streaming context is optional
  console.error(`[create-source] Stream context setup failed:`, err);
}

console.log(text);
