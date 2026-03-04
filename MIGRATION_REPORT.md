# Migration Report: slash-trade -> paste-trade-skill

## Summary

This repo was rebuilt as a public, install-critical `/trade` skill package.
Source reviewed: `/Users/satoshi/dev/slash-trade`
Target: `/Users/satoshi/dev/paste-trade-skill`

## What was copied

### Runtime

- `SKILL.md` (rewritten for stable public instructions)
- `skill/adapters/assess.ts`
- `skill/adapters/board/{connect,create-source,ensure-key,finalize-source,post,run-id,stream-context,stream-thought,trace-audit}.ts`
- `skill/adapters/extraction/{save,run-count,validate}.ts`
- `skill/adapters/transcript/{extract,diarize}.ts`
- `skill/adapters/hyperliquid/universe.ts`
- `skill/adapters/edit/{common,upload-source-text}.ts`
- `skill/types.ts`

### OpenClaw plugin/runtime glue

- `openclaw-plugin/{index.js,index-lib.mjs,run-trade-wrapper.mjs,run-trade-wrapper-lib.mjs,trade-slash-dispatch-lib.mjs,openclaw.plugin.json,package.json}`
- `scripts/setup-openclaw-wrapper.sh` (new public setup helper)

### Public docs and release/governance docs

- `README.md`
- `docs/install/{openclaw,claude-code,codex}.md`
- `CHANGELOG.md`
- `docs/releases/v1.0.0-notes-template.md`
- `SECURITY.md`
- `CONTRIBUTING.md`

## What was intentionally excluded

- `/web` app assets
- `/paste-trade` app and worker code
- `/data` contents and runtime snapshots
- `/memory` notes
- `.claude`, `.cursor`, `.obsidian`, local editor/system artifacts
- archived references and historical docs not required for runtime install/use
- test artifacts and monorepo-only scripts not required for public install

## Candidate optional (excluded for now)

- `skill/adapters/x/*` profile scan helpers
- full edit-mode adapter set beyond `upload-source-text`
- adapter test files and extra adapter families not required by the public v1 flow

## Key migration decisions

1. Keep `/trade` command name unchanged.
2. Keep OpenClaw wrapper plugin in-repo and make setup explicit via script + docs.
3. Keep runtime minimal but coherent for extract -> route -> post -> finalize.
4. Remove user-facing `slash-trade` naming in public docs.
5. Do not ship local data, internal planning docs, or private/dev scaffolding.

## Known risks / TODO before launch

1. Validate `npx skills add ...` install flow in fresh OpenClaw, Claude Code, and Codex environments.
2. Confirm OpenClaw default installed skill path in docs for non-default workspaces.
3. Run end-to-end `/trade` smoke tests against production `paste.trade` API from each client.
4. Decide whether additional edit-mode adapters should be added in a later public release.
