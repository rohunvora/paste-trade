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
- runs `/trade` in a private per-chat worker lane so `/trade` does not pollute your main context
- queues later `/trade` requests from the same chat instead of racing them
- sends a progress link as soon as source creation finishes for that specific run, including queued runs that start later
- sends only the compact final summary back to chat instead of intermediate worker chatter
- rotates to a fresh hidden worker lane after the queue drains
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
- if another `/trade` is already running in that chat, an immediate queued acknowledgement instead
- a progress link as soon as that run's source page is ready
- one compact final summary when routing and posting finish, even for queued runs

No login required — the skill auto-provisions your identity on first run.

## Update

Paste the repo URL into your agent again:

```
https://github.com/rohunvora/paste-trade-skill
```

Then rerun wrapper setup:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

See [Account portability](../../README.md#account-portability) for multi-client key sharing and web sign-in.
