import { createHash } from "crypto";
import { appendFileSync, mkdirSync } from "fs";
import os from "os";
import path from "path";

const MAX_TRACE_STRING_CHARS = 300;

const DEFAULT_TRACE_LOG_PATH = path.join(
  os.homedir(),
  ".openclaw",
  "logs",
  "trade-slash-wrapper.audit.log",
);

function sanitizeTraceString(value: unknown): string {
  return String(value)
    .replace(/\0/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_TRACE_STRING_CHARS);
}

export function hashForTrace(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function appendTraceEvent(event: Record<string, unknown>, opts?: { traceLogPath?: string }): void {
  const traceLogPath = opts?.traceLogPath ?? DEFAULT_TRACE_LOG_PATH;
  const line = JSON.stringify(
    {
      ts: new Date().toISOString(),
      event,
    },
    (_key, value) => (typeof value === "string" ? sanitizeTraceString(value) : value),
  );

  mkdirSync(path.dirname(traceLogPath), { recursive: true });
  appendFileSync(traceLogPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}
