import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MAX_RAW_ARG_CHARS = 65_536;
export const MAX_SESSION_KEY_CHARS = 512;
export const MAX_IDEMPOTENCY_KEY_CHARS = 256;
export const MAX_TARGET_CHARS = 256;
export const MAX_RUN_ID_CHARS = 64;
export const MAX_MESSAGE_CHARS = 24_000;
export const MAX_EXTRA_SYSTEM_PROMPT_CHARS = 24_000;
export const MAX_AUDIT_STRING_CHARS = 400;
export const MAX_CHILD_OUTPUT_CHARS = 280;
export const GATEWAY_CALL_TIMEOUT_MS = 20_000;
export const GATEWAY_CALL_MAX_ATTEMPTS = 3;
export const GATEWAY_CALL_RETRY_DELAY_MS = 1_200;
// How long to wait for the agent to finish the trade run before logging a timeout.
// Long-form sources can take several minutes once routing and posting begin.
export const AGENT_WAIT_TIMEOUT_MS = 900_000;
export const SESSION_LOOKUP_TIMEOUT_MS = 10_000;
export const DIRECT_SEND_TIMEOUT_MS = 15_000;
export const LIVE_LINK_POLL_INTERVAL_MS = 750;
export const LIVE_LINK_WAIT_TIMEOUT_MS = 90_000;
const KNOWN_MESSAGE_CHANNELS = new Set([
  "telegram",
  "whatsapp",
  "discord",
  "signal",
  "imessage",
  "slack",
  "sms",
  "email",
]);

export const DEFAULT_AUDIT_LOG_PATH = path.join(
  os.homedir(),
  ".openclaw",
  "logs",
  "trade-slash-wrapper.audit.log",
);
export const DEFAULT_TRADE_RUNTIME_AUDIT_LOG_PATH = path.join(
  process.env.PASTE_TRADE_STATE_DIR?.trim() ||
    (process.env.XDG_STATE_HOME?.trim()
      ? path.join(process.env.XDG_STATE_HOME.trim(), "paste-trade")
      : path.join(os.homedir(), ".paste-trade")),
  "logs",
  "trade-runtime.audit.log",
);
const RUNTIME_DATA_DIR_CANDIDATES = [
  fileURLToPath(new URL("../data", import.meta.url)),
  fileURLToPath(new URL("../../data", import.meta.url)),
];

function resolveRuntimeDataDirPath() {
  for (const candidate of RUNTIME_DATA_DIR_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return RUNTIME_DATA_DIR_CANDIDATES[0];
}

export const DEFAULT_STREAM_CONTEXT_DIR_PATH = resolveRuntimeDataDirPath();

export function hashForAudit(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function sanitizeAuditString(value) {
  return String(value)
    .replace(/\0/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_AUDIT_STRING_CHARS);
}

function summarizeChildOutput(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = sanitizeAuditString(value);
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, MAX_CHILD_OUTPUT_CHARS);
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function sleepAsync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runExecFile(cmd, args, options, execFileImpl = execFile) {
  return new Promise((resolve) => {
    execFileImpl(cmd, args, options, (error, stdout, stderr) => {
      resolve({
        status:
          error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0,
        error: error ?? null,
        stdout: typeof stdout === "string" ? stdout : "",
        stderr: typeof stderr === "string" ? stderr : "",
      });
    });
  });
}

function shouldRetryGatewayCall(result) {
  if (!result || result.status === 0) {
    return false;
  }
  const combined = [
    result.error ? String(result.error.message || result.error) : "",
    typeof result.stderr === "string" ? result.stderr : "",
    typeof result.stdout === "string" ? result.stdout : "",
  ]
    .join("\n")
    .toLowerCase();

  return (
    combined.includes("gateway timeout") ||
    combined.includes("closed before connect") ||
    combined.includes("econnrefused") ||
    combined.includes("connection refused") ||
    combined.includes("econnreset")
  );
}

function assertNoNullBytes(value, fieldName) {
  if (value.includes("\0")) {
    throw new Error(`${fieldName} contains null bytes`);
  }
}

function assertBoundedString(value, fieldName, maxChars) {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  if (!value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  if (value.length > maxChars) {
    throw new Error(`${fieldName} is too long (${value.length}). Max ${maxChars}.`);
  }
  assertNoNullBytes(value, fieldName);
  return value.trim();
}

export function parseWrapperPayload(rawArg) {
  if (typeof rawArg !== "string" || !rawArg) {
    throw new Error("missing payload");
  }
  if (rawArg.length > MAX_RAW_ARG_CHARS) {
    throw new Error(`payload arg too large (${rawArg.length}). Max ${MAX_RAW_ARG_CHARS}.`);
  }
  assertNoNullBytes(rawArg, "payload");

  let parsed;
  try {
    parsed = JSON.parse(rawArg);
  } catch {
    throw new Error("payload is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("payload must be a JSON object");
  }

  const sessionKey = assertBoundedString(parsed.sessionKey, "sessionKey", MAX_SESSION_KEY_CHARS);
  const idempotencyKey = assertBoundedString(
    parsed.idempotencyKey,
    "idempotencyKey",
    MAX_IDEMPOTENCY_KEY_CHARS,
  );
  const target =
    parsed.target === undefined || parsed.target === null
      ? null
      : assertBoundedString(parsed.target, "target", MAX_TARGET_CHARS);
  const runId =
    parsed.runId === undefined || parsed.runId === null
      ? null
      : assertBoundedString(parsed.runId, "runId", MAX_RUN_ID_CHARS);
  const message = assertBoundedString(parsed.message, "message", MAX_MESSAGE_CHARS);
  const extraSystemPrompt =
    parsed.extraSystemPrompt === undefined || parsed.extraSystemPrompt === null
      ? null
      : assertBoundedString(
          parsed.extraSystemPrompt,
          "extraSystemPrompt",
          MAX_EXTRA_SYSTEM_PROMPT_CHARS,
        );

  return { sessionKey, idempotencyKey, target, runId, message, extraSystemPrompt };
}

export function deriveMessageChannelFromSessionKey(sessionKey) {
  const normalized = typeof sessionKey === "string" ? sessionKey.trim().toLowerCase() : "";
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("agent:")) {
    const parts = normalized.split(":");
    const channel = parts[2] ?? "";
    return KNOWN_MESSAGE_CHANNELS.has(channel) ? channel : null;
  }

  const first = normalized.split(":")[0] ?? "";
  return KNOWN_MESSAGE_CHANNELS.has(first) ? first : null;
}

export function deriveTelegramTargetFromSessionKey(sessionKey) {
  const normalized = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!normalized) {
    return null;
  }

  const directMatch = normalized.match(/^agent:[^:]+:telegram:direct:(.+)$/i);
  if (directMatch && directMatch[1].trim()) {
    return directMatch[1].trim();
  }

  const slashMatch = normalized.match(/^agent:[^:]+:telegram:slash:(.+)$/i);
  if (slashMatch && slashMatch[1].trim()) {
    return slashMatch[1].trim();
  }

  const rawDirect = normalized.match(/^telegram:direct:(.+)$/i);
  if (rawDirect && rawDirect[1].trim()) {
    return rawDirect[1].trim();
  }

  const rawSlash = normalized.match(/^telegram:slash:(.+)$/i);
  if (rawSlash && rawSlash[1].trim()) {
    return rawSlash[1].trim();
  }

  return null;
}

export function deriveAgentSessionNamespace(sessionKey) {
  const normalized = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!normalized) {
    return {
      agentId: "main",
      sessionChannel: "main",
    };
  }

  if (normalized.startsWith("agent:")) {
    const parts = normalized.split(":");
    const agentId = parts[1]?.trim() || "main";
    const sessionChannel = parts[2]?.trim() || "main";
    return { agentId, sessionChannel };
  }

  return {
    agentId: "main",
    sessionChannel: deriveMessageChannelFromSessionKey(normalized) || "main",
  };
}

export function buildTradeSessionKey(sessionKey, runSuffix) {
  const { agentId, sessionChannel } = deriveAgentSessionNamespace(sessionKey);
  return `agent:${agentId}:${sessionChannel}:trade:${runSuffix}`;
}

export function buildAgentCallParams(payload) {
  // Use a fresh per-run session key so the agent starts with an empty conversation.
  // Without this, the trade prompt enters the user's existing conversation where
  // prior messages (status checks, debugging) cause the model to respond
  // conversationally instead of executing the skill.
  const runSuffix = payload.runId || payload.idempotencyKey;
  const tradeSessionKey = buildTradeSessionKey(payload.sessionKey, runSuffix);

  const params = {
    sessionKey: tradeSessionKey,
    message: payload.message,
    idempotencyKey: payload.idempotencyKey,
    // The wrapper owns all user-visible delivery. The worker runs silently in an
    // isolated session so intermediate progress chatter cannot leak into chat.
    deliver: false,
    ...(payload.extraSystemPrompt ? { extraSystemPrompt: payload.extraSystemPrompt } : {}),
  };

  return JSON.stringify(params);
}

export function buildChatSendParams(payload) {
  return buildAgentCallParams(payload);
}

export function appendAuditEvent(event, opts = {}) {
  const auditLogPath = opts.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH;
  const line = JSON.stringify(
    {
      ts: new Date().toISOString(),
      event,
    },
    (_key, value) => (typeof value === "string" ? sanitizeAuditString(value) : value),
  );

  mkdirSync(path.dirname(auditLogPath), { recursive: true });
  appendFileSync(auditLogPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

function summarizePayloadForAudit(payload) {
  return {
    sessionKeyHash: hashForAudit(payload.sessionKey),
    targetHash: payload.target ? hashForAudit(payload.target) : null,
    idempotencyKeyHash: hashForAudit(payload.idempotencyKey),
    runIdHash: payload.runId ? hashForAudit(payload.runId) : null,
    messageHash: hashForAudit(payload.message),
    messageLength: payload.message.length,
    extraSystemPromptHash: payload.extraSystemPrompt ? hashForAudit(payload.extraSystemPrompt) : null,
    extraSystemPromptLength: payload.extraSystemPrompt?.length ?? 0,
  };
}

function readTradeRuntimeEventsForRun(runId, opts = {}) {
  if (typeof runId !== "string" || !runId.trim()) {
    return [];
  }

  const traceLogPath = opts.traceLogPath ?? DEFAULT_TRADE_RUNTIME_AUDIT_LOG_PATH;
  if (!existsSync(traceLogPath)) {
    return [];
  }

  const runIdHash = hashForAudit(runId);
  try {
    const lines = readFileSync(traceLogPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && entry.event && entry.event.runIdHash === runIdHash)
      .map((entry) => entry.event);
  } catch {
    return [];
  }
}

function summarizeRuntimeEvents(events) {
  const eventTypes = Array.from(
    new Set(
      (Array.isArray(events) ? events : [])
        .map((entry) => (entry && typeof entry.type === "string" ? entry.type : ""))
        .filter(Boolean),
    ),
  );

  return {
    eventTypes,
    createdSource: eventTypes.includes("trade_run_created_source"),
    finalized: eventTypes.includes("trade_run_finalize_emitted"),
  };
}

function fetchSessionMessages(sessionKey, spawnSyncImpl) {
  if (typeof sessionKey !== "string" || !sessionKey.trim()) {
    return { ok: false, reason: "missing_session_key", messages: [] };
  }

  const result = spawnSyncImpl(
    "openclaw",
    [
      "gateway",
      "call",
      "sessions.get",
      "--json",
      "--timeout",
      String(SESSION_LOOKUP_TIMEOUT_MS),
      "--params",
      JSON.stringify({
        key: sessionKey,
        limit: 80,
      }),
    ],
    {
      stdio: "pipe",
      encoding: "utf8",
      maxBuffer: 128 * 1024,
      timeout: SESSION_LOOKUP_TIMEOUT_MS + 5_000,
      shell: false,
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      reason: result.error ? String(result.error.message || result.error) : "sessions_get_failed",
      stderr: summarizeChildOutput(result.stderr),
      messages: [],
    };
  }

  try {
    const parsed = JSON.parse(result.stdout || "{}");
    return {
      ok: true,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return {
      ok: false,
      reason: "sessions_get_parse_failed",
      messages: [],
    };
  }
}

function sessionHasToolActivity(messages) {
  let toolResultCount = 0;
  let assistantToolCallCount = 0;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== "object") {
      continue;
    }

    if (message.role === "toolResult" || message.role === "tool") {
      toolResultCount += 1;
      continue;
    }

    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    for (const block of message.content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      if (
        block.type === "toolCall" ||
        block.type === "toolUse" ||
        block.type === "functionCall"
      ) {
        assistantToolCallCount += 1;
      }
    }
  }

  return {
    confirmed: toolResultCount > 0 || assistantToolCallCount > 0,
    toolResultCount,
    assistantToolCallCount,
  };
}

function extractAssistantText(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block) => block && typeof block === "object" && block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .replace(/\[\[reply_to_current\]\]\s*/g, "")
    .trim();
}

function hasAssistantToolCall(content) {
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some(
    (block) =>
      block &&
      typeof block === "object" &&
      (block.type === "toolCall" || block.type === "toolUse" || block.type === "functionCall"),
  );
}

function readFinalAssistantMessage(sessionKey, spawnSyncImpl) {
  const sessionLookup = fetchSessionMessages(sessionKey, spawnSyncImpl);
  if (!sessionLookup.ok) {
    return {
      ok: false,
      reason: sessionLookup.reason ?? "sessions_get_failed",
      stderr: sessionLookup.stderr ?? null,
      message: "",
    };
  }

  const messages = Array.isArray(sessionLookup.messages) ? sessionLookup.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    if (hasAssistantToolCall(message.content)) {
      continue;
    }
    const text = extractAssistantText(message.content);
    if (!text) {
      continue;
    }
    return {
      ok: true,
      reason: null,
      stderr: null,
      message: text,
    };
  }

  return {
    ok: true,
    reason: null,
    stderr: null,
    message: "",
  };
}

function verifyTradeExecution(payload, tradeSessionKey, spawnSyncImpl, opts = {}) {
  const runtimeEvents = payload.runId ? readTradeRuntimeEventsForRun(payload.runId, opts) : [];
  const runtimeSummary = summarizeRuntimeEvents(runtimeEvents);
  if (runtimeSummary.eventTypes.length > 0) {
    return {
      confirmed: true,
      source: "runtime_trace",
      runtimeEventTypes: runtimeSummary.eventTypes,
      createdSource: runtimeSummary.createdSource,
      finalized: runtimeSummary.finalized,
      toolResultCount: 0,
      assistantToolCallCount: 0,
      sessionLookupOk: true,
    };
  }

  const sessionLookup = fetchSessionMessages(tradeSessionKey, spawnSyncImpl);
  const sessionSummary = sessionHasToolActivity(sessionLookup.messages);
  return {
    confirmed: sessionSummary.confirmed,
    source: sessionSummary.confirmed ? "session_tool_activity" : null,
    runtimeEventTypes: [],
    createdSource: false,
    finalized: false,
    toolResultCount: sessionSummary.toolResultCount,
    assistantToolCallCount: sessionSummary.assistantToolCallCount,
    sessionLookupOk: sessionLookup.ok,
    sessionLookupReason: sessionLookup.reason ?? null,
    sessionLookupStderr: sessionLookup.stderr ?? null,
  };
}

function buildNotifyParams(payload, message, channel, target) {
  return JSON.stringify({
    sessionKey: payload.sessionKey,
    message,
    idempotencyKey: `${payload.idempotencyKey}-${hashForAudit(message)}`,
    deliver: true,
    ...(channel ? { channel } : {}),
    ...(target ? { to: target } : {}),
  });
}

function streamContextFilePath(runId, streamContextDirPath = DEFAULT_STREAM_CONTEXT_DIR_PATH) {
  return path.join(streamContextDirPath, `.stream-context-${runId}.json`);
}

function readStreamContextForRun(runId, opts = {}) {
  if (typeof runId !== "string" || !runId.trim()) {
    return null;
  }

  const contextPath = streamContextFilePath(runId.trim(), opts.streamContextDirPath);
  if (!existsSync(contextPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(contextPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const sourceId = typeof parsed.source_id === "string" ? parsed.source_id.trim() : "";
    const sourceUrl = typeof parsed.source_url === "string" ? parsed.source_url.trim() : "";
    const contextRunId = typeof parsed.run_id === "string" ? parsed.run_id.trim() : runId.trim();
    if (!sourceId || !sourceUrl) {
      return null;
    }
    return {
      sourceId,
      sourceUrl,
      runId: contextRunId,
      contextPath,
    };
  } catch {
    return null;
  }
}

async function waitForLiveLinkContext(runId, opts = {}) {
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && opts.pollIntervalMs > 0
    ? opts.pollIntervalMs
    : LIVE_LINK_POLL_INTERVAL_MS;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0
    ? opts.timeoutMs
    : AGENT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (typeof opts.shouldStop === "function" && opts.shouldStop()) {
      return null;
    }
    const ctx = readStreamContextForRun(runId, opts);
    if (ctx) {
      return ctx;
    }
    await sleepAsync(pollIntervalMs);
  }
  return null;
}

export function buildDirectSendArgs(channel, target, message) {
  return [
    "message",
    "send",
    "--json",
    "--channel",
    channel,
    "--target",
    target,
    "--message",
    message,
  ];
}

function sendDirectMessage(channel, target, message, spawnSyncImpl) {
  if (
    typeof channel !== "string" ||
    !channel.trim() ||
    typeof target !== "string" ||
    !target.trim() ||
    typeof message !== "string" ||
    !message.trim()
  ) {
    return {
      ok: false,
      reason: "missing_delivery_target",
      status: null,
      stdout: null,
      stderr: null,
    };
  }

  const result = spawnSyncImpl(
    "openclaw",
    buildDirectSendArgs(channel.trim(), target.trim(), message.trim()),
    {
      stdio: "pipe",
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: DIRECT_SEND_TIMEOUT_MS,
      shell: false,
      windowsHide: true,
    },
  );

  return {
    ok: !result.error && result.status === 0,
    reason: result.error ? String(result.error.message || result.error) : null,
    status: result.status ?? null,
    stdout: summarizeChildOutput(result.stdout),
    stderr: summarizeChildOutput(result.stderr),
  };
}

function sendWrapperNotice(payload, message, channel, target, spawnSyncImpl) {
  if (channel && target) {
    return {
      mode: "direct_send",
      ...sendDirectMessage(channel, target, message, spawnSyncImpl),
    };
  }

  const notifyParams = buildNotifyParams(payload, message, channel, target);
  const result = spawnSyncImpl(
    "openclaw",
    ["gateway", "call", "agent", "--json", "--timeout", "10000", "--params", notifyParams],
    {
      stdio: "ignore",
      timeout: 15_000,
      shell: false,
      windowsHide: true,
    },
  );
  return {
    mode: "agent_notify_fallback",
    ok: !result.error && result.status === 0,
    reason: result.error ? String(result.error.message || result.error) : null,
    status: result.status ?? null,
    stdout: null,
    stderr: null,
  };
}

export async function runWrapper(rawArg, opts = {}) {
  const spawnSyncImpl = opts.spawnSyncImpl ?? spawnSync;
  const runAsyncCommandImpl =
    opts.runAsyncCommandImpl ??
    ((cmd, args, options) => {
      if (opts.spawnSyncImpl) {
        return Promise.resolve(spawnSyncImpl(cmd, args, options));
      }
      return runExecFile(cmd, args, options, opts.execFileImpl ?? execFile);
    });
  const auditLogPath = opts.auditLogPath;

  let payload;
  try {
    payload = parseWrapperPayload(rawArg);
  } catch (error) {
    appendAuditEvent(
      {
        type: "trade_wrapper_invalid_payload",
        reason: error instanceof Error ? error.message : String(error),
      },
      { auditLogPath },
    );
    return 2;
  }

  const auditBase = summarizePayloadForAudit(payload);
  const channel = deriveMessageChannelFromSessionKey(payload.sessionKey);
  const target =
    typeof payload.target === "string" && payload.target.trim()
      ? payload.target.trim()
      : deriveTelegramTargetFromSessionKey(payload.sessionKey);
  const deliveryMeta = {
    channel: channel ?? null,
    targetHash: target ? hashForAudit(target) : auditBase.targetHash,
    targetPresent: Boolean(target),
    handoffMessageLength: payload.message.length,
    handoffExtraSystemPromptLength: payload.extraSystemPrompt?.length ?? 0,
  };
  const tradeSessionKey = buildTradeSessionKey(
    payload.sessionKey,
    payload.runId || payload.idempotencyKey,
  );
  let params;
  try {
    params = buildAgentCallParams(payload);
  } catch (error) {
    appendAuditEvent(
      {
        type: "trade_wrapper_handoff_preflight_failed",
        ...auditBase,
        ...deliveryMeta,
        reason: error instanceof Error ? error.message : String(error),
      },
      { auditLogPath },
    );
    return 1;
  }

  let result = null;
  for (let attempt = 1; attempt <= GATEWAY_CALL_MAX_ATTEMPTS; attempt++) {
    result = spawnSyncImpl(
      "openclaw",
      [
        "gateway",
        "call",
        "agent",
        "--json",
        "--timeout",
        String(GATEWAY_CALL_TIMEOUT_MS),
        "--params",
        params,
      ],
      {
        stdio: "pipe",
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: GATEWAY_CALL_TIMEOUT_MS + 5_000,
        shell: false,
        windowsHide: true,
      },
    );
    if (!result.error && result.status === 0) {
      break;
    }
    if (attempt >= GATEWAY_CALL_MAX_ATTEMPTS || !shouldRetryGatewayCall(result)) {
      break;
    }
    appendAuditEvent(
      {
        type: "trade_wrapper_handoff_retry",
        ...auditBase,
        ...deliveryMeta,
        attempt,
        status: result.status ?? null,
        error: result.error ? String(result.error.message || result.error) : null,
        stderr: summarizeChildOutput(result.stderr),
        stdout: summarizeChildOutput(result.stdout),
      },
      { auditLogPath },
    );
    sleepMs(GATEWAY_CALL_RETRY_DELAY_MS * attempt);
  }

  if (!result || result.error || result.status !== 0) {
    appendAuditEvent(
      {
        type: "trade_wrapper_handoff_failed",
        ...auditBase,
        ...deliveryMeta,
        status: result.status ?? null,
        error: result.error ? String(result.error.message || result.error) : null,
        stderr: summarizeChildOutput(result.stderr),
        stdout: summarizeChildOutput(result.stdout),
      },
      { auditLogPath },
    );
    return 1;
  }

  appendAuditEvent(
    {
      type: "trade_wrapper_handoff_started",
      ...auditBase,
      ...deliveryMeta,
      status: result.status ?? 0,
    },
    { auditLogPath },
  );

  // Watchdog: wait for the agent run to finish and log the outcome.
  // The gateway `agent` RPC returns { runId, acceptedAt } on success.
  let gatewayRunId = null;
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    gatewayRunId = typeof parsed.runId === "string" ? parsed.runId : null;
  } catch {
    // Non-JSON response — skip watchdog
  }

  if (gatewayRunId) {
    const waitParams = JSON.stringify({
      runId: gatewayRunId,
      timeoutMs: AGENT_WAIT_TIMEOUT_MS,
    });
    let waitCompleted = false;
    const waitResultPromise = runAsyncCommandImpl(
      "openclaw",
      [
        "gateway",
        "call",
        "agent.wait",
        "--json",
        "--timeout",
        String(AGENT_WAIT_TIMEOUT_MS + 5_000),
        "--params",
        waitParams,
      ],
      {
        stdio: "pipe",
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: AGENT_WAIT_TIMEOUT_MS + 15_000,
        shell: false,
        windowsHide: true,
      },
    );

    const liveLinkPromise =
      payload.runId && channel && target
        ? (async () => {
            const ctx = await waitForLiveLinkContext(payload.runId, {
              streamContextDirPath: opts.streamContextDirPath,
              pollIntervalMs: opts.liveLinkPollIntervalMs,
              timeoutMs: LIVE_LINK_WAIT_TIMEOUT_MS,
              shouldStop: () => waitCompleted,
            });
            if (!ctx) {
              return { attempted: false, sent: false, reason: "context_not_found" };
            }

            const delivery = sendDirectMessage(
              channel,
              target,
              `Watch live: ${ctx.sourceUrl}`,
              spawnSyncImpl,
            );
            appendAuditEvent(
              {
                type: delivery.ok ? "trade_wrapper_live_link_sent" : "trade_wrapper_live_link_failed",
                ...auditBase,
                channel,
                targetHash: hashForAudit(target),
                runIdHash: hashForAudit(payload.runId),
                sourceIdHash: hashForAudit(ctx.sourceId),
                sourceUrlHash: hashForAudit(ctx.sourceUrl),
                deliveryMode: "direct_send",
                deliveryStatus: delivery.status,
                deliveryReason: delivery.reason,
                deliveryStdout: delivery.stdout,
                deliveryStderr: delivery.stderr,
              },
              { auditLogPath },
            );
            return {
              attempted: true,
              sent: delivery.ok,
              reason: delivery.reason,
              sourceIdHash: hashForAudit(ctx.sourceId),
              sourceUrlHash: hashForAudit(ctx.sourceUrl),
            };
          })()
        : Promise.resolve({
            attempted: false,
            sent: false,
            reason: payload.runId ? "missing_delivery_target" : "missing_run_id",
          });

    const waitResult = await waitResultPromise;
    waitCompleted = true;
    const liveLinkResult = await liveLinkPromise;

    let waitStatus = "unknown";
    try {
      const parsed = JSON.parse(waitResult.stdout || "{}");
      waitStatus = parsed.status || "unknown";
    } catch {
      // ignore parse errors
    }

    const verification = verifyTradeExecution(payload, tradeSessionKey, spawnSyncImpl, opts);
    const verificationMeta = {
      tradeSessionKeyHash: hashForAudit(tradeSessionKey),
      executionConfirmed: verification.confirmed,
      executionConfirmationSource: verification.source,
      runtimeEventTypes: verification.runtimeEventTypes,
      runtimeCreatedSource: verification.createdSource,
      runtimeFinalized: verification.finalized,
      sessionLookupOk: verification.sessionLookupOk,
      sessionLookupReason: verification.sessionLookupReason ?? null,
      sessionLookupStderr: verification.sessionLookupStderr ?? null,
      toolResultCount: verification.toolResultCount,
      assistantToolCallCount: verification.assistantToolCallCount,
      liveLinkAttempted: liveLinkResult.attempted,
      liveLinkSent: liveLinkResult.sent,
      liveLinkReason: liveLinkResult.reason ?? null,
      liveLinkSourceIdHash: liveLinkResult.sourceIdHash ?? null,
      liveLinkSourceUrlHash: liveLinkResult.sourceUrlHash ?? null,
    };
    const finalAssistantMessage =
      waitResult.status === 0 && waitStatus === "ok"
        ? readFinalAssistantMessage(tradeSessionKey, spawnSyncImpl)
        : {
            ok: false,
            reason: "wait_not_completed",
            stderr: null,
            message: "",
          };
    const finalAssistantMeta = {
      finalMessageLookupOk: finalAssistantMessage.ok,
      finalMessageLookupReason: finalAssistantMessage.reason ?? null,
      finalMessageLookupStderr: finalAssistantMessage.stderr ?? null,
      finalMessageHash: finalAssistantMessage.message
        ? hashForAudit(finalAssistantMessage.message)
        : null,
      finalMessageLength: finalAssistantMessage.message.length,
    };

    if (waitResult.error || waitResult.status !== 0) {
      appendAuditEvent(
        {
          type: "trade_wrapper_wait_failed",
          ...auditBase,
          ...verificationMeta,
          ...finalAssistantMeta,
          gatewayRunId: hashForAudit(gatewayRunId),
          waitStatus,
          waitError: waitResult.error ? String(waitResult.error.message || waitResult.error) : null,
          waitStderr: summarizeChildOutput(waitResult.stderr),
          waitStdout: summarizeChildOutput(waitResult.stdout),
          waitExitCode: waitResult.status ?? null,
        },
        { auditLogPath },
      );
    } else if (waitStatus === "ok" && verification.confirmed) {
      appendAuditEvent(
        {
          type: "trade_wrapper_run_completed",
          ...auditBase,
          ...verificationMeta,
          ...finalAssistantMeta,
          gatewayRunId: hashForAudit(gatewayRunId),
          waitStatus,
        },
        { auditLogPath },
      );

      const completionMessage =
        finalAssistantMessage.message ||
        (liveLinkResult.sent ? "The /trade run finished. Open the progress link for the final trades." : "");
      if (completionMessage && channel && target) {
        const notifyResult = sendWrapperNotice(
          payload,
          completionMessage,
          channel,
          target,
          spawnSyncImpl,
        );
        appendAuditEvent(
          {
            type: notifyResult.ok
              ? "trade_wrapper_final_message_sent"
              : "trade_wrapper_final_message_failed",
            ...auditBase,
            ...verificationMeta,
            ...finalAssistantMeta,
            channel: channel ?? null,
            targetHash: target ? hashForAudit(target) : null,
            noticeHash: hashForAudit(completionMessage),
            noticeMode: notifyResult.mode,
            noticeStatus: notifyResult.status,
            noticeReason: notifyResult.reason,
          },
          { auditLogPath },
        );
      }
    } else if (waitStatus === "ok") {
      appendAuditEvent(
        {
          type: "trade_wrapper_run_unconfirmed",
          ...auditBase,
          ...verificationMeta,
          ...finalAssistantMeta,
          gatewayRunId: hashForAudit(gatewayRunId),
          waitStatus,
        },
        { auditLogPath },
      );
    } else {
      const eventType = waitStatus === "timeout" ? "trade_wrapper_run_timeout" : "trade_wrapper_run_error";
      appendAuditEvent(
        {
          type: eventType,
          ...auditBase,
          ...verificationMeta,
          ...finalAssistantMeta,
          gatewayRunId: hashForAudit(gatewayRunId),
          waitStatus,
          waitError: waitResult.error ? String(waitResult.error.message || waitResult.error) : null,
          waitStderr: summarizeChildOutput(waitResult.stderr),
        },
        { auditLogPath },
      );

      let notifyMessage = null;
      if (waitStatus === "timeout" && verification.confirmed && !liveLinkResult.sent) {
        notifyMessage =
          "Still working in the background. I'll send a progress link as soon as it's ready.";
      } else if (waitStatus === "error") {
        notifyMessage =
          "The /trade run hit an internal error before it could finish. Resend the source to retry.";
      }

      if (notifyMessage) {
        const notifyResult = sendWrapperNotice(
          payload,
          notifyMessage,
          channel,
          target,
          spawnSyncImpl,
        );
        appendAuditEvent(
          {
            type: notifyResult.ok ? "trade_wrapper_notice_sent" : "trade_wrapper_notice_failed",
            ...auditBase,
            channel: channel ?? null,
            targetHash: target ? hashForAudit(target) : null,
            noticeHash: hashForAudit(notifyMessage),
            noticeMode: notifyResult.mode,
            noticeStatus: notifyResult.status,
            noticeReason: notifyResult.reason,
          },
          { auditLogPath },
        );
      }
    }
  }

  return 0;
}
