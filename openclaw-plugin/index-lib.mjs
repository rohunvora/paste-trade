import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACK_TEXT,
  MAX_COMMAND_CHARS,
  USAGE_TEXT,
  buildWrapperPayload,
  queueTradeWrapper,
  readCommandArg,
} from "./trade-slash-dispatch-lib.mjs";
import { appendAuditEvent, hashForAudit } from "./run-trade-wrapper-lib.mjs";

export const TRADE_COMMAND_TOOL = "trade_slash_dispatch";
export const WRAPPER_SCRIPT_PATH = fileURLToPath(new URL("./run-trade-wrapper.mjs", import.meta.url));

const tradeDispatchToolSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    command: {
      type: "string",
      description: "Raw /trade arguments (everything after /trade).",
    },
    commandName: {
      type: "string",
      description: "Slash command name.",
    },
    skillName: {
      type: "string",
      description: "Skill name resolved by OpenClaw.",
    },
  },
};

export function createTradeDispatchTool(api, ctx, deps = {}) {
  const queueTradeWrapperImpl = deps.queueTradeWrapperImpl ?? queueTradeWrapper;
  const appendAuditEventImpl = deps.appendAuditEventImpl ?? appendAuditEvent;
  const existsSyncImpl = deps.existsSyncImpl ?? existsSync;
  return {
    name: TRADE_COMMAND_TOOL,
    label: "Trade Slash Dispatch",
    description:
      "Acknowledge /trade immediately, run it in an isolated background session, and return only the progress link and final summary to chat.",
    parameters: tradeDispatchToolSchema,
    execute: async (_toolCallId, rawArgs) => {
      const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
      const command = readCommandArg(args);
      if (!command) {
        return {
          content: USAGE_TEXT,
          details: {
            status: "usage_error",
            reason: "missing_command",
          },
        };
      }

      if (command.length > MAX_COMMAND_CHARS) {
        return {
          content: `Error: /trade input is too long (${command.length} chars). Max ${MAX_COMMAND_CHARS}.`,
          details: {
            status: "error",
            reason: "input_too_long",
            max: MAX_COMMAND_CHARS,
          },
        };
      }

      const sessionKey = typeof ctx.sessionKey === "string" ? ctx.sessionKey.trim() : "";
      if (!sessionKey) {
        return {
          content: "Error: could not resolve the target chat session for /trade.",
          details: {
            status: "error",
            reason: "missing_session_key",
          },
        };
      }

      let payload;
      const runId = randomUUID().replace(/-/g, "").slice(0, 12);
      try {
        payload = buildWrapperPayload({
          command,
          sessionKey,
          idempotencyKey: `trade-wrapper-${runId}-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
          runId,
        });
      } catch (error) {
        return {
          content: `Error: failed to prepare /trade payload: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            status: "error",
            reason: "payload_build_failed",
          },
        };
      }

      const auditMeta = {
        sourceSessionKeyHash: hashForAudit(sessionKey),
        targetSessionKeyHash: hashForAudit(payload.sessionKey),
        sessionRemapped: payload.sessionKey !== sessionKey,
        targetHash: payload.target ? hashForAudit(payload.target) : null,
        runIdHash: payload.runId ? hashForAudit(payload.runId) : null,
        messageHash: hashForAudit(payload.message),
        messageLength: payload.message.length,
      };

      try {
        if (!existsSyncImpl(WRAPPER_SCRIPT_PATH)) {
          api.logger.warn("trade slash wrapper: wrapper script path missing", {
            ...auditMeta,
            wrapperScriptPath: WRAPPER_SCRIPT_PATH,
          });
          return {
            content: "Error: /trade wrapper script is missing on this host.",
            details: {
              status: "error",
              reason: "missing_wrapper_script",
            },
          };
        }

        const result = queueTradeWrapperImpl(payload, { scriptPath: WRAPPER_SCRIPT_PATH });
        if (result.status !== "accepted") {
          api.logger.warn("trade slash wrapper: failed to queue /trade handoff", {
            ...auditMeta,
            exitCode: result.exitCode,
            reason: result.reason,
          });
          return {
            content: "Error: failed to queue /trade handoff.",
            details: {
              status: "error",
              reason: "handoff_failed",
              exitCode: result.exitCode,
            },
          };
        }

        api.logger.info("trade slash wrapper: queued /trade handoff", {
          ...auditMeta,
          childPid: result.pid ?? null,
        });
        appendAuditEventImpl({
          type: "trade_wrapper_ack_sent",
          ...auditMeta,
          ackLength: ACK_TEXT.length,
        });
      } catch (error) {
        api.logger.warn("trade slash wrapper: failed to queue /trade handoff", {
          ...auditMeta,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          content: `Error: failed to queue /trade: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            status: "error",
            reason: "queue_failed",
          },
        };
      }

      return {
        content: ACK_TEXT,
        details: {
          status: "accepted",
          targetSessionKeyHash: hashForAudit(payload.sessionKey),
          sessionRemapped: payload.sessionKey !== sessionKey,
          runId: payload.runId ?? null,
        },
      };
    },
  };
}
