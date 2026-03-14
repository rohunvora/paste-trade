import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appendAuditEvent, hashForAudit } from "./run-trade-wrapper-lib.mjs";

export const ACK_TEXT = "Running /trade in the background now. I'll send a progress link shortly.";
export const USAGE_TEXT = "Usage: /trade <thesis, URL, or source text>";
export const MAX_COMMAND_CHARS = 20_000;
export const MAX_RUN_ID_CHARS = 64;

const SKILL_LAYOUT_CANDIDATES = [
  {
    skillRootUrl: new URL("..", import.meta.url),
    skillFileUrl: new URL("../SKILL.md", import.meta.url),
    scriptsDirUrl: new URL("../scripts", import.meta.url),
    referencesDirUrl: new URL("../references", import.meta.url),
  },
  {
    skillRootUrl: new URL("../..", import.meta.url),
    skillFileUrl: new URL("../../SKILL.md", import.meta.url),
    scriptsDirUrl: new URL("../../skill/scripts", import.meta.url),
    referencesDirUrl: new URL("../../skill/references", import.meta.url),
  },
];

function resolveSkillLayout() {
  for (const candidate of SKILL_LAYOUT_CANDIDATES) {
    const skillFilePath = fileURLToPath(candidate.skillFileUrl);
    const scriptsDirPath = fileURLToPath(candidate.scriptsDirUrl);
    const referencesDirPath = fileURLToPath(candidate.referencesDirUrl);

    if (existsSync(skillFilePath) && existsSync(scriptsDirPath) && existsSync(referencesDirPath)) {
      return {
        skillRootPath: fileURLToPath(candidate.skillRootUrl),
        skillFilePath,
        scriptsDirPath,
        referencesDirPath,
      };
    }
  }

  const fallback = SKILL_LAYOUT_CANDIDATES[0];
  return {
    skillRootPath: fileURLToPath(fallback.skillRootUrl),
    skillFilePath: fileURLToPath(fallback.skillFileUrl),
    scriptsDirPath: fileURLToPath(fallback.scriptsDirUrl),
    referencesDirPath: fileURLToPath(fallback.referencesDirUrl),
  };
}

const RESOLVED_SKILL_LAYOUT = resolveSkillLayout();
export const SKILL_ROOT_PATH = RESOLVED_SKILL_LAYOUT.skillRootPath;
export const SKILL_FILE_PATH = RESOLVED_SKILL_LAYOUT.skillFilePath;
export const SCRIPTS_DIR_PATH = RESOLVED_SKILL_LAYOUT.scriptsDirPath;
export const REFERENCES_DIR_PATH = RESOLVED_SKILL_LAYOUT.referencesDirPath;

const TELEGRAM_SLASH_PREFIX = "telegram:slash:";
const TELEGRAM_DIRECT_PREFIX_NO_AGENT = "telegram:direct:";
const TELEGRAM_DIRECT_PREFIX = "agent:main:telegram:direct:";
const AGENT_TELEGRAM_SLASH_PATTERN = /^agent:([^:]+):telegram:slash:(.+)$/i;
const AGENT_TELEGRAM_DIRECT_PATTERN = /^agent:([^:]+):telegram:direct:(.+)$/i;
const DEFAULT_QUEUE_MAX_ATTEMPTS = 2;
const DEFAULT_QUEUE_RETRY_DELAY_MS = 600;
const MAX_CHILD_OUTPUT_CHARS = 280;

export function readCommandArg(args) {
  const value = args?.command;
  return typeof value === "string" ? value.trim() : "";
}

export function buildTradePrompt(input, runId) {
  const lines = [
    `Execute the isolated /trade request from the additional system instructions now.`,
    `Your FIRST action must be a tool call. Do not repeat the wrapper acknowledgement.`,
  ];
  if (typeof runId === "string" && runId.trim()) {
    lines.push(`Internal tracing metadata: run_id=${runId.trim()}.`);
  }
  if (typeof input === "string" && input.trim()) {
    lines.push(`User input summary:\n${input.trim()}`);
  }
  return lines.join("\n\n");
}

export function buildTradeSystemPrompt(input, runId) {
  const lines = [
    `IMPORTANT: Your FIRST action must be a tool call — do not generate any text before calling a tool.`,
    `Read the skill file at ${SKILL_FILE_PATH} and follow its instructions for this trade request.`,
    `When SKILL.md tells you to run a script or read a reference file, resolve it against these absolute runtime directories: scripts under ${SCRIPTS_DIR_PATH} and references under ${REFERENCES_DIR_PATH}.`,
    `Wrapper delivery overrides the shared chat rules: the user already received the initial acknowledgement, and the wrapper will deliver the Watch live link immediately after \`create-source.ts\` succeeds. Do not repeat the acknowledgement and do not send \`Watch live: {source_url}\` yourself.`,
    `Keep the isolated worker chat-silent while the pipeline runs. Do not send progress/status chatter like "Now let me..." or "All posted...". Your only plain-text assistant message in this run should be the compact final summary, or a brief no-trade result, after all posting and finalization work completes.`,
  ];
  if (typeof runId === "string" && runId.trim()) {
    lines.push(
      `Internal tracing metadata (do not repeat to the user): run_id=${runId.trim()}. Reuse this run_id in create-source payload and every adapter --run-id call.`,
    );
  }
  lines.push(`User input:\n${input}`);
  return lines.join("\n\n");
}

function isTelegramSessionKey(sessionKey) {
  const normalized = typeof sessionKey === "string" ? sessionKey.trim().toLowerCase() : "";
  return normalized.startsWith("telegram:") || normalized.includes(":telegram:");
}

export function normalizeTradeSessionKey(sessionKey) {
  const normalized = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (lower.startsWith(TELEGRAM_SLASH_PREFIX)) {
    const chatId = normalized.slice(TELEGRAM_SLASH_PREFIX.length).trim();
    if (!chatId) {
      return "";
    }
    return `${TELEGRAM_DIRECT_PREFIX}${chatId}`;
  }

  if (lower.startsWith(TELEGRAM_DIRECT_PREFIX_NO_AGENT)) {
    const chatId = normalized.slice(TELEGRAM_DIRECT_PREFIX_NO_AGENT.length).trim();
    if (!chatId) {
      return "";
    }
    return `${TELEGRAM_DIRECT_PREFIX}${chatId}`;
  }

  const slashMatch = normalized.match(AGENT_TELEGRAM_SLASH_PATTERN);
  if (slashMatch) {
    const agentId = slashMatch[1].trim();
    const chatId = slashMatch[2].trim();
    if (!agentId || !chatId) {
      return "";
    }
    return `agent:${agentId}:telegram:direct:${chatId}`;
  }

  return normalized;
}

export function deriveTelegramTargetFromSessionKey(sessionKey) {
  const normalized = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!normalized) {
    return "";
  }

  if (normalized.toLowerCase().startsWith(TELEGRAM_SLASH_PREFIX)) {
    return normalized.slice(TELEGRAM_SLASH_PREFIX.length).trim();
  }
  if (normalized.toLowerCase().startsWith(TELEGRAM_DIRECT_PREFIX_NO_AGENT)) {
    return normalized.slice(TELEGRAM_DIRECT_PREFIX_NO_AGENT.length).trim();
  }
  if (normalized.toLowerCase().startsWith(TELEGRAM_DIRECT_PREFIX)) {
    return normalized.slice(TELEGRAM_DIRECT_PREFIX.length).trim();
  }

  const directMatch = normalized.match(AGENT_TELEGRAM_DIRECT_PATTERN);
  if (directMatch) {
    return directMatch[2].trim();
  }
  const slashMatch = normalized.match(AGENT_TELEGRAM_SLASH_PATTERN);
  if (slashMatch) {
    return slashMatch[2].trim();
  }

  return "";
}

export function buildWrapperPayload({ command, sessionKey, idempotencyKey, runId }) {
  const normalizedCommand = typeof command === "string" ? command.trim() : "";
  if (!normalizedCommand) {
    throw new Error("command is required");
  }

  const targetSessionKey = normalizeTradeSessionKey(sessionKey);
  if (!targetSessionKey) {
    throw new Error("sessionKey is required");
  }

  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw new Error("idempotencyKey is required");
  }

  const normalizedRunId = typeof runId === "string" ? runId.trim() : "";
  if (normalizedRunId && normalizedRunId.length > MAX_RUN_ID_CHARS) {
    throw new Error(`runId is too long (${normalizedRunId.length}). Max ${MAX_RUN_ID_CHARS}.`);
  }

  const target = deriveTelegramTargetFromSessionKey(targetSessionKey);
  if (isTelegramSessionKey(targetSessionKey) && !target) {
    throw new Error("telegram target could not be derived from sessionKey");
  }

  return {
    sessionKey: targetSessionKey,
    target: target || undefined,
    idempotencyKey: idempotencyKey.trim(),
    runId: normalizedRunId || undefined,
    message: buildTradePrompt(normalizedCommand, normalizedRunId || undefined),
    extraSystemPrompt: buildTradeSystemPrompt(normalizedCommand, normalizedRunId || undefined),
  };
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

function summarizeChildOutput(value) {
  const text =
    typeof value === "string" ? value : value && typeof value.toString === "function" ? value.toString("utf8") : "";
  const normalized = text.replace(/\0/g, "").replace(/[\r\n\t]+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_CHILD_OUTPUT_CHARS);
}

function collectChildOutput(child) {
  const state = {
    stdout: "",
    stderr: "",
  };
  const attach = (stream, key) => {
    if (!stream || typeof stream.on !== "function") {
      return;
    }
    stream.on("data", (chunk) => {
      const text = summarizeChildOutput(chunk);
      if (!text) {
        return;
      }
      state[key] = summarizeChildOutput(`${state[key]} ${text}`) ?? state[key];
    });
  };
  attach(child.stdout, "stdout");
  attach(child.stderr, "stderr");
  return state;
}

function queueRetryDelayMs(attempt, baseDelayMs) {
  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(baseDelayMs * attempt));
}

export function queueTradeWrapper(payload, opts = {}) {
  const spawnImpl = opts.spawnImpl ?? spawn;
  const appendAuditEventImpl = opts.appendAuditEventImpl ?? appendAuditEvent;
  const auditLogPath = opts.auditLogPath;
  const scriptPath = typeof opts.scriptPath === "string" ? opts.scriptPath.trim() : "";
  const maxAttempts = Math.max(1, Number.isFinite(opts.maxAttempts) ? Math.floor(opts.maxAttempts) : DEFAULT_QUEUE_MAX_ATTEMPTS);
  const retryDelayMs =
    Number.isFinite(opts.retryDelayMs) && opts.retryDelayMs >= 0
      ? Math.floor(opts.retryDelayMs)
      : DEFAULT_QUEUE_RETRY_DELAY_MS;
  const auditMeta = summarizePayloadForAudit(payload);

  if (!scriptPath) {
    throw new Error("scriptPath is required");
  }

  appendAuditEventImpl(
    {
      type: "trade_wrapper_queue_accepted",
      ...auditMeta,
    },
    { auditLogPath },
  );

  const spawnAttempt = (attempt) => {
    let child;
    try {
      child = spawnImpl(process.execPath, [scriptPath, JSON.stringify(payload)], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      appendAuditEventImpl(
        {
          type: "trade_wrapper_queue_failed",
          ...auditMeta,
          attempt,
          reason,
        },
        { auditLogPath },
      );
      return attempt === 1 ? { status: "error", reason, exitCode: null } : null;
    }

    if (child && typeof child.unref === "function") {
      child.unref();
    }

    if (!child || typeof child.on !== "function") {
      return attempt === 1
        ? { status: "accepted", pid: null, exitCode: 0 }
        : null;
    }

    const output = collectChildOutput(child);
    let settled = false;
    const handleFailure = (event) => {
      if (settled) {
        return;
      }
      settled = true;

      const diagnostics = {
        stdout: summarizeChildOutput(output.stdout),
        stderr: summarizeChildOutput(output.stderr),
      };

      if (attempt < maxAttempts) {
        appendAuditEventImpl(
          {
            type: "trade_wrapper_queue_retry",
            ...auditMeta,
            attempt,
            ...event,
            ...diagnostics,
          },
          { auditLogPath },
        );
        setTimeout(() => {
          spawnAttempt(attempt + 1);
        }, queueRetryDelayMs(attempt, retryDelayMs));
        return;
      }

      appendAuditEventImpl(
        {
          type: "trade_wrapper_queue_failed",
          ...auditMeta,
          attempt,
          ...event,
          ...diagnostics,
        },
        { auditLogPath },
      );
    };

    child.on("error", (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      handleFailure({ reason });
    });

    child.on("exit", (exitCode, signal) => {
      if (exitCode === 0 && !signal) {
        if (attempt > 1) {
          appendAuditEventImpl(
            {
              type: "trade_wrapper_queue_recovered",
              ...auditMeta,
              attempt,
            },
            { auditLogPath },
          );
        }
        return;
      }
      handleFailure({
        exitCode: typeof exitCode === "number" ? exitCode : null,
        signal: signal ?? null,
      });
    });

    return attempt === 1
      ? {
          status: "accepted",
          pid: typeof child.pid === "number" ? child.pid : null,
          exitCode: 0,
        }
      : null;
  };

  const firstAttemptResult = spawnAttempt(1);
  if (firstAttemptResult && firstAttemptResult.status === "error") {
    return firstAttemptResult;
  }

  return {
    status: "accepted",
    pid: firstAttemptResult && typeof firstAttemptResult.pid === "number" ? firstAttemptResult.pid : null,
    exitCode: 0,
  };
}
