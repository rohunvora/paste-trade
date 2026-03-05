#!/usr/bin/env bun
/**
 * Deprecated alias for `route-check.ts`.
 * Kept for backward compatibility while routing call sites migrate.
 */

import { runRouteCheckCli } from "./route-check";

console.error("[assess.ts] Deprecated alias. Use: bun run skill-dev/skill-v2-lab/scripts/route-check.ts ...");

runRouteCheckCli(process.argv).catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
