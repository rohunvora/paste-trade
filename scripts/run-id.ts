export const RUN_ID_ENV = "PASTE_TRADE_RUN_ID";

/** Extract optional --run-id <id> from argv-like args and return the remaining args. */
export function extractRunIdArg(argv: string[] = process.argv): { runId: string | null; args: string[] } {
  const args = [...argv.slice(2)];
  let runId = process.env[RUN_ID_ENV] ?? null;
  const idx = args.indexOf("--run-id");
  if (idx !== -1) {
    const value = args[idx + 1];
    if (!value) {
      console.error("[run-id] Missing value after --run-id");
      process.exit(1);
    }
    runId = value;
    args.splice(idx, 2);
  }
  return { runId, args };
}

/** Set process env run_id for this adapter invocation. */
export function applyRunId(runId: string | null | undefined): void {
  if (runId) process.env[RUN_ID_ENV] = runId;
}
