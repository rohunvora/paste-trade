# AGENTS.md

This repository ships the public `/trade` skill for `paste.trade`.

## Canonical Runtime Source

- Use [`SKILL.md`](./SKILL.md) as the runtime source of truth.
- Keep the `/trade` command name unchanged.
- If this file conflicts with `SKILL.md`, follow `SKILL.md` and update `AGENTS.md`.

## Runtime Guardrails

- X login is secondary and must not block first `/trade` run.
- Preferred portability path: reuse one `PASTE_TRADE_KEY` across clients.
- Fallback portability path: run connect/link flow for split keys (`bun run skill/adapters/board/connect.ts`).
- OpenClaw `/trade` dispatch depends on `trade-slash-wrapper`.
- OpenClaw setup instructions are in [`docs/install/openclaw.md`](./docs/install/openclaw.md).

## Install and Update Commands

Install:
- `npx skills add rohunvora/paste-trade-skill@v1 -a openclaw`
- `npx skills add rohunvora/paste-trade-skill@v1 -a claude-code`
- `npx skills add rohunvora/paste-trade-skill@v1 -a codex`

Update:
- `npx skills add rohunvora/paste-trade-skill@latest -a openclaw`
- `npx skills add rohunvora/paste-trade-skill@latest -a claude-code`
- `npx skills add rohunvora/paste-trade-skill@latest -a codex`

## Scope Boundary

This repo is install-critical skill/runtime/docs only.  
Do not treat it as the web app or worker app source repository.
