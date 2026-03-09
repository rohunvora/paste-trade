#!/usr/bin/env bun
/**
 * Deprecated alias for `route.ts`.
 * Kept for backward compatibility while call sites migrate.
 */

import { runRouteCli } from "./route";

console.error("[route-check.ts] Deprecated alias. Use: bun run skill/scripts/route.ts ...");

runRouteCli(process.argv).catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
