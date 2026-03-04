# Changelog

All notable changes to `paste-trade-skill` will be documented here.

## [1.0.0] - 2026-03-03

### Added

- Public `/trade` runtime adapters required for extract -> route -> post -> finalize flow.
- OpenClaw slash wrapper plugin (`trade-slash-wrapper`) and setup script.
- Public install/update docs for OpenClaw, Claude Code, and Codex.
- Public governance docs: `SECURITY.md`, `CONTRIBUTING.md`.
- Release notes template for v1.
- Migration report documenting copied/excluded assets and launch risks.

### Changed

- Replaced internal/private skill instructions with stable public `SKILL.md` guidance.
- Removed local `.claude` artifact write from runtime post adapter.
- Added runtime-safe source artifact directory creation in transcript adapters.

### Excluded by design

- Web app, worker app, archived/internal references, local memory/data snapshots.
