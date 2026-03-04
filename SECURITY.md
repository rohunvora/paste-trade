# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately to the maintainers before public disclosure.
Include:
- affected file(s) and behavior
- reproduction steps
- expected vs actual behavior
- impact assessment

## Scope

In scope for this repo:
- `/trade` skill runtime files
- OpenClaw wrapper plugin files
- install/update docs

Out of scope for this repo:
- `paste.trade` web app/worker internals not present here

## Sensitive data handling

- Never commit secrets (`PASTE_TRADE_KEY`, `X_BEARER_TOKEN`, `GEMINI_API_KEY`, etc.).
- Keep local credentials in `.env` only.
- Treat all generated keys as account credentials and rotate if leaked.

## Hardening baseline

- Use least-privilege keys.
- Keep dependencies updated.
- Review external API and shell command surfaces during PR review.
