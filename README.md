# paste-trade-skill

Public `/trade` skill runtime for `paste.trade`.

This repository includes only install-critical assets:
- skill runtime files under `skill/`
- OpenClaw wrapper plugin under `openclaw-plugin/`
- public install/update and operational docs

## Supported clients

- OpenClaw
- Claude Code
- Codex

## Install

### OpenClaw

```bash
npx skills add rohunvora/paste-trade-skill@v1 -a openclaw
```

Then install/enable the bundled wrapper plugin:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

If your OpenClaw workspace is custom, run the same script from your workspace `skills/trade` directory.

### Claude Code

```bash
npx skills add rohunvora/paste-trade-skill@v1 -a claude-code
```

### Codex

```bash
npx skills add rohunvora/paste-trade-skill@v1 -a codex
```

## Use Cases and Example Inputs

- YouTube (podcasts, long videos, interviews): Gemini API is best for multi-speaker videos.
```text
/trade https://www.youtube.com/watch?v=<video_id>
```

- Twitter/X (tweets or entire profiles): X API is preferred.
```text
/trade https://x.com/<handle>/status/<tweet_id>
/trade https://x.com/<handle> (profile scan when supported in your client/runtime)
```

- Articles and PDFs:
```text
/trade https://example.com/research-note
/trade https://example.com/report.pdf
```

- Screenshots:
```text
/trade [attach screenshot] route every tradeable thesis in this image
```

- Anything (raw thesis or market observation):
```text
/trade NVDA is down 25% and Blackwell demand is unchanged. route the cleanest expression.
```

## Update

### OpenClaw

```bash
npx skills add rohunvora/paste-trade-skill@latest -a openclaw
```

After update, rerun wrapper setup:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

### Claude Code

```bash
npx skills add rohunvora/paste-trade-skill@latest -a claude-code
```

### Codex

```bash
npx skills add rohunvora/paste-trade-skill@latest -a codex
```

## Account portability

- Preferred path: use one `PASTE_TRADE_KEY` across OpenClaw, Claude Code, and Codex.
- Fallback for users who already created separate keys: run the connect/link flow (`bun run skill/adapters/board/connect.ts`) from the account you want to keep.
- X login is secondary. It should not block first `/trade` run.

## Docs

- [OpenClaw install/update](docs/install/openclaw.md)
- [Claude Code install/update](docs/install/claude-code.md)
- [Codex install/update](docs/install/codex.md)
- [Release notes skeleton](docs/releases/v1.0.0-notes-template.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
