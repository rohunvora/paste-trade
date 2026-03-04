# AGENTS.md Specification

## Status

Draft v1 (for `paste-trade-skill`)

## Objective

Define what `AGENTS.md` must do in this repository so installed users get predictable `/trade` behavior across OpenClaw, Claude Code, and Codex.

## Why This Exists

- `SKILL.md` is the full runtime behavior contract.
- `AGENTS.md` is a thin cross-client stability layer.
- Contributor/maintenance policy must not be mixed into shipped runtime guidance.

## Design Principles

1. User-first: optimize first-run success and predictable runtime behavior.
2. Thin-by-default: keep `AGENTS.md` short and durable.
3. No duplication debt: reference canonical docs instead of restating full workflows.
4. No private assumptions: avoid local-only paths, internal infra notes, or dev-only workflows.

## Scope

In scope for `AGENTS.md`:
- command invariants (`/trade` must remain unchanged)
- canonical source pointer (`SKILL.md`)
- runtime guardrails that materially affect user outcomes
- install/update command contract (or pointer to a single canonical doc)
- wrapper dependency clarity for OpenClaw

Out of scope for `AGENTS.md`:
- maintainer checklists
- release process details
- migration history
- PR policy and repo governance
- local development ergonomics

## Canonical Source and Precedence

1. `SKILL.md` is canonical for `/trade` execution flow and runtime semantics.
2. `AGENTS.md` provides cross-client guardrails only.
3. If `AGENTS.md` and `SKILL.md` conflict, update `AGENTS.md` to match `SKILL.md`.
4. Maintainer policy lives in `MAINTENANCE.md` and `CONTRIBUTING.md`.

## Required Sections in AGENTS.md

1. Purpose
- State that the repo ships the public `paste.trade` `/trade` skill.

2. Canonical Runtime Source
- Explicit pointer to `SKILL.md`.
- Explicit statement that `/trade` command name is immutable.

3. Runtime Guardrails
- X login is secondary and must not block first `/trade` run.
- Account portability guidance: shared `PASTE_TRADE_KEY` preferred, connect/link fallback for split keys.
- OpenClaw wrapper dependency is explicit (`trade-slash-wrapper`) with install doc pointer.

4. Install and Update Contract
- Exact install/update commands for OpenClaw, Claude Code, Codex.
- Commands must match README and install docs exactly.

5. Scope Boundary
- Clarify this repo is install-critical skill/runtime/docs only.

## Prohibited Content in AGENTS.md

- Private URLs, keys, tokens, secrets.
- Internal planning notes or migration logs.
- Contributor-only enforcement checklists.
- Detailed adapter internals that duplicate `SKILL.md`.
- Any language that suggests web/worker app source lives here.

## Format Constraints

- Keep under 120 lines.
- Use direct, imperative language.
- Prefer links over long prose.
- Avoid version/date churn unless required for correctness.

## Sync Contract

When any of these change, review `AGENTS.md` in the same PR:
- `/trade` command behavior expectations in `SKILL.md`
- install/update commands in README or `docs/install/*`
- OpenClaw wrapper dependency/setup behavior
- portability/key guidance

## Acceptance Criteria

An `AGENTS.md` revision is valid only if all are true:
1. It does not conflict with `SKILL.md`.
2. It contains only installed-user runtime guardrails.
3. It includes exact install/update commands or a canonical pointer.
4. It keeps OpenClaw wrapper dependency explicit.
5. It has no secrets/private URLs.
6. It avoids maintainer process content.

## Suggested Minimal Template

```md
# AGENTS.md

This repository ships the public `/trade` skill for `paste.trade`.

## Canonical Runtime Source
- Use `SKILL.md` as the runtime source of truth.
- Do not rename `/trade`.

## Runtime Guardrails
- X login is secondary and must not block first `/trade` run.
- Reuse one `PASTE_TRADE_KEY` across clients when possible.
- For split keys, use connect/link flow.
- OpenClaw `/trade` depends on `trade-slash-wrapper`; see install docs.

## Install and Update Commands
- (exact commands)

## Scope Boundary
- This repo contains install-critical skill/runtime/docs only.
```
