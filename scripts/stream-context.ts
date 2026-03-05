/**
 * Shared helper for live streaming context — per-run isolation.
 *
 * Each /trade invocation gets its own context file keyed by run_id:
 *   data/.stream-context-{runId}.json
 *
 * Callers must provide a run_id via env or explicit argument. This file is
 * intentionally strict: if run_id is missing, we do not guess using "most
 * recent context" because that hides wiring bugs and can misattribute events.
 */

import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "fs";

// Resolve repo root: this file is at skill-dev/skill-v2-lab/scripts/stream-context.ts
// so repo root is 3 directories up.
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DATA_DIR = join(REPO_ROOT, "data");
const CONTEXT_PREFIX = ".stream-context-";

import { RUN_ID_ENV } from "./run-id";
import { appendTraceEvent, hashForTrace } from "./trace-audit";

export interface StreamContext {
  source_id: string;
  source_url: string;
  created_at: string;
  run_id: string;
  thesis_count?: number;
}

/** Get the context file path for a specific run_id. */
function contextFilePath(runId: string): string {
  return join(DATA_DIR, `${CONTEXT_PREFIX}${runId}.json`);
}

/** Find all context files in data/, sorted by mtime descending (newest first). */
function findContextFiles(): string[] {
  try {
    return readdirSync(DATA_DIR)
      .filter(f => f.startsWith(CONTEXT_PREFIX) && f.endsWith(".json"))
      .map(f => join(DATA_DIR, f))
      .sort((a, b) => {
        try { return statSync(b).mtimeMs - statSync(a).mtimeMs; }
        catch { return 0; }
      });
  } catch {
    return [];
  }
}

/** Read the stream context for an explicit or env-derived run_id. */
export function getStreamContext(runId?: string | null): StreamContext | null {
  const resolvedRunId = runId ?? process.env[RUN_ID_ENV] ?? null;
  if (!resolvedRunId) return null;
  try {
    return JSON.parse(readFileSync(contextFilePath(resolvedRunId), "utf8"));
  } catch {
    return null;
  }
}

/** Write the stream context file for a specific run. */
export function writeStreamContext(ctx: StreamContext): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(contextFilePath(ctx.run_id), JSON.stringify(ctx, null, 2));
  // Set env for this process; other adapter invocations should pass --run-id.
  process.env[RUN_ID_ENV] = ctx.run_id;
}

/** Increment and return the per-session thesis counter. */
export function incrementThesisCount(runId?: string | null): number {
  const ctx = getStreamContext(runId);
  if (!ctx) return 1;
  const next = (ctx.thesis_count ?? 0) + 1;
  ctx.thesis_count = next;
  writeFileSync(contextFilePath(ctx.run_id), JSON.stringify(ctx, null, 2));
  return next;
}

/** Remove the context file for the current run. */
export function clearStreamContext(runId?: string | null): void {
  const ctx = getStreamContext(runId);
  if (!ctx) return;
  try { unlinkSync(contextFilePath(ctx.run_id)); } catch { /* already gone */ }
}

/**
 * Clean up stale context files older than maxAgeMs (default: 20 minutes).
 * Called by create-source.ts at the start of each run.
 */
export function cleanupStaleContextFiles(maxAgeMs = 20 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;
  for (const file of findContextFiles()) {
    try {
      const stat = statSync(file);
      if (now - stat.mtimeMs > maxAgeMs) {
        unlinkSync(file);
        cleaned++;
      }
    } catch { /* already gone or can't stat */ }
  }
  return cleaned;
}

/** Load a key from the repo .env file directly (doesn't depend on cwd). */
function loadEnvKey(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const text = readFileSync(join(REPO_ROOT, ".env"), "utf8");
    const match = text.match(new RegExp(`^${key}=(.+)$`, "m"));
    return match?.[1]?.trim();
  } catch { return undefined; }
}

/** Push an event to the API and return whether it succeeded.
 *  Includes run_id in the event data for traceability. */
export async function pushEvent(
  sourceId: string,
  eventType: string,
  data: Record<string, unknown>,
  opts?: { runId?: string | null },
): Promise<boolean> {
  const runId = opts?.runId ?? process.env[RUN_ID_ENV] ?? null;
  const eventData = runId ? { ...data, run_id: runId } : data;

  const baseUrl = loadEnvKey("PASTE_TRADE_URL") || loadEnvKey("BOARD_URL") || loadEnvKey("BELIEF_BOARD_URL") || "https://paste.trade";
  const apiKey = loadEnvKey("PASTE_TRADE_KEY");
  const url = `${baseUrl}/api/sources/${sourceId}/events`;
  const requestBody = JSON.stringify({ event_type: eventType, data: eventData });
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[stream-event] ${eventType} failed (${res.status}) for source ${sourceId}: ${text.slice(0, 200)}`);
      appendTraceEvent({
        type: "trade_run_stream_event_failed",
        runIdHash: runId ? hashForTrace(runId) : null,
        sourceIdHash: hashForTrace(sourceId),
        eventType,
        status: res.status,
        payloadChars: requestBody.length,
      });
      return false;
    }
    appendTraceEvent({
      type: "trade_run_stream_event_sent",
      runIdHash: runId ? hashForTrace(runId) : null,
      sourceIdHash: hashForTrace(sourceId),
      eventType,
      payloadChars: requestBody.length,
    });
    return true;
  } catch (err) {
    console.error(`[stream-event] ${eventType} errored for source ${sourceId}: ${(err as Error).message}`);
    appendTraceEvent({
      type: "trade_run_stream_event_errored",
      runIdHash: runId ? hashForTrace(runId) : null,
      sourceIdHash: hashForTrace(sourceId),
      eventType,
      payloadChars: requestBody.length,
      reason: (err as Error).message,
    });
    return false;
  }
}
