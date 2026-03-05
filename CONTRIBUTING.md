# Contributing

For strict temporary planning/scratch handling, see [`TEMPORARY_WORK_POLICY.md`](./TEMPORARY_WORK_POLICY.md).

## Goal

Keep this repository limited to public install-critical assets for `/trade`.

## Include

- runtime scripts required for `/trade` (`scripts/`)
- instrument discovery adapters (`adapters/`)
- OpenClaw wrapper/plugin files required for `/trade` dispatch
- concise public docs for install, update, and operations

## Exclude

- web/worker apps
- local data or memory snapshots
- private notes and internal planning docs
- secrets or environment dumps
- temporary artifacts outside `.scratch/`

## Pull request checklist

- [ ] `/trade` runtime path still coherent (extract -> route -> post -> finalize)
- [ ] OpenClaw wrapper dependency remains explicit and documented
- [ ] install/update commands remain accurate for all supported clients
- [ ] no secrets/private URLs in committed files
- [ ] `CHANGELOG.md` updated for every user-visible or runtime-behavior change

## Runtime Non-Negotiables

1. Keep command name `/trade` unchanged.
2. Keep public naming as `paste.trade` / `paste-trade-skill`.
3. Do not commit secrets.
4. Do not make OpenClaw wrapper setup implicit.

## Install and Update Consistency

If install/update commands change, update all:
- `README.md`
- `docs/install/openclaw.md`
- `docs/install/claude-code.md`
- `docs/install/codex.md`

If OpenClaw wrapper behavior changes, update:
- `docs/install/openclaw.md`
- `README.md`
- `scripts/setup-openclaw-wrapper.sh` (if needed)
