# Contributing

## Goal

Keep this repository limited to public install-critical assets for `/trade`.

## Include

- runtime files required for `/trade`
- OpenClaw wrapper/plugin files required for `/trade` dispatch
- concise public docs for install, update, and operations

## Exclude

- web/worker apps
- local data or memory snapshots
- private notes and internal planning docs
- secrets or environment dumps

## Pull request checklist

- [ ] `/trade` runtime path still coherent (extract -> route -> post -> finalize)
- [ ] OpenClaw wrapper dependency remains explicit and documented
- [ ] install/update commands remain accurate for all supported clients
- [ ] no legacy pre-migration naming in user-facing docs
- [ ] no secrets/private URLs in committed files

## Validation

Run the checks you can from this repo and include results in PR notes.
At minimum:
- syntax checks for shell scripts
- runtime import/path sanity checks
- grep scan for obvious secret leakage
