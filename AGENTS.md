# AGENTS.md

Compatibility shim for agent runtimes.

Canonical behavior lives in [`SKILL.md`](./SKILL.md).

If this file conflicts with `SKILL.md`, follow `SKILL.md`.

## Runtime Invariants

1. Keep command `/trade` unchanged.
2. Keep OpenClaw tool name `trade_slash_dispatch` unchanged.
3. For URL inputs: run `scripts/extract.ts`, then `scripts/create-source.ts` before long follow-up steps.
4. Reuse one `run_id` across adapter calls in a run.
5. Finalization must include every saved thesis exactly once (no drops, no duplicates).
6. First run must work without any login — identity is auto-provisioned via API key.

## Scope

This repo contains skill runtime and install-critical docs only.
