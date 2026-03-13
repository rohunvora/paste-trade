# OpenClaw Install and Update

## Install

Paste the repo URL into your agent:

```
https://github.com/rohunvora/paste-trade-skill
```

## Required OpenClaw-only bridge setup

`/trade` dispatch in OpenClaw depends on the bundled `trade-slash-wrapper`
bridge plugin.

This is OpenClaw-specific. Claude Code and Codex do not install or use it.

What it does:
- acknowledges `/trade` immediately in your current chat
- starts the real run in a separate background session so `/trade` does not pollute your main context
- sends a progress link as soon as source creation finishes
- sends only the compact final summary back to chat instead of intermediate worker chatter
- remaps Telegram slash sessions back to the DM thread when needed

Run this once after install, and again after every update:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

What this does:
- installs `openclaw-plugin/` via `openclaw plugins install --link`
- ensures `plugins.allow` includes `trade-slash-wrapper`
- lets OpenClaw detect the config change and reload automatically

## Verify

```bash
openclaw skills info trade
openclaw plugins info trade-slash-wrapper
```

## First run

```text
/trade https://x.com/<handle>/status/<id>
```

Expected chat flow:
- immediate acknowledgement that the run started in the background
- a progress link as soon as the source page is ready
- one compact final summary when routing and posting finish

X login is optional and should not block first run.

## Update

Paste the repo URL into your agent again:

```
https://github.com/rohunvora/paste-trade-skill
```

Then rerun wrapper setup:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

## Account portability

- Preferred: reuse one `PASTE_TRADE_KEY` across clients.
- Fallback (separate keys already created): run `bun run scripts/connect.ts` on the key/account you want to keep.
