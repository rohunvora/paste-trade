# OpenClaw Install and Update

## Install

```bash
npx skills add rohunvora/paste-trade-skill@v2 -a openclaw
```

## Required wrapper/plugin setup

`/trade` dispatch in OpenClaw depends on the bundled `trade-slash-wrapper` plugin.
Run this once after install, and again after every update:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

What this does:
- installs `openclaw-plugin/` via `openclaw plugins install --link`
- ensures `plugins.allow` includes `trade-slash-wrapper`
- restarts the OpenClaw gateway

## Verify

```bash
openclaw skills info trade
openclaw plugins info trade-slash-wrapper
```

## First run

```text
/trade https://x.com/<handle>/status/<id>
```

X login is optional and should not block first run.

## Update

```bash
npx skills add rohunvora/paste-trade-skill@latest -a openclaw
```

Then rerun wrapper setup:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

## Account portability

- Preferred: reuse one `PASTE_TRADE_KEY` across clients.
- Fallback (separate keys already created): run `bun run scripts/connect.ts` on the key/account you want to keep.
