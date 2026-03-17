/**
 * Push a narration moment to the live source page.
 * The model calls this once before save.ts to share its 1st pass analysis.
 *
 * Usage:
 *   bun run skill/scripts/stream-thought.ts --run-id <runId> "Found 4 theses: oil supply risk, gold safe haven, defense rally, Israel posture"
 */

import { applyRunId, extractRunIdArg } from "./run-id";
import { getStreamContext, pushEvent } from "./stream-context";

const { runId, args } = extractRunIdArg(process.argv);
applyRunId(runId);

const message = args[0];
if (!message) {
  console.error("Usage: bun run skill/scripts/stream-thought.ts --run-id <runId> '<message>'");
  process.exit(1);
}

const ctx = getStreamContext(runId);
if (!ctx) {
  console.error("[stream-thought] No stream context — skipping");
  process.exit(0);
}

const ok = await pushEvent(ctx.source_id, "thought", { message }, { runId });
if (!ok) {
  console.error("[stream-thought] Failed to push status event");
}
console.log(JSON.stringify({ ok, source_id: ctx.source_id }));
