# paste-trade-skill

Public `/trade` skill runtime for [paste.trade](https://paste.trade).

Finds every tradeable thesis in a source and routes each to an executable trade. Works with tweets, podcasts, articles, screenshots, hunches, and market observations.

## Supported clients

- OpenClaw
- Claude Code
- Codex

## Install

### OpenClaw

```bash
npx skills add rohunvora/paste-trade-skill@v2 -a openclaw
```

Then install/enable the bundled wrapper plugin:

```bash
bash ~/.openclaw/skills/trade/scripts/setup-openclaw-wrapper.sh
```

### Claude Code

```bash
npx skills add rohunvora/paste-trade-skill@v2 -a claude-code
```

### Codex

```bash
npx skills add rohunvora/paste-trade-skill@v2 -a codex
```

## Prerequisites

- [Bun](https://bun.sh) runtime
- `yt-dlp` for YouTube extraction (install via `brew install yt-dlp` or `pip install yt-dlp`)
- Optional: `GEMINI_API_KEY` for multi-speaker diarization
- Optional: `X_BEARER_TOKEN` for X/Twitter API (falls back to free extraction without it)

## Use cases

YouTube (podcasts, long videos, interviews):
```text
/trade https://www.youtube.com/watch?v=<video_id>
```

Twitter/X (tweets):
```text
/trade https://x.com/<handle>/status/<tweet_id>
```

Articles and PDFs:
```text
/trade https://example.com/research-note
```

Screenshots:
```text
/trade [attach screenshot] route every tradeable thesis in this image
```

Direct thesis (raw market observation):
```text
/trade NVDA is down 25% and Blackwell demand is unchanged. route the cleanest expression.
```

## Update

### OpenClaw

```bash
npx skills add rohunvora/paste-trade-skill@latest -a openclaw
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
- Fallback for users who already created separate keys: run `bun run scripts/connect.ts` from the account you want to keep.
- X login is optional. It should not block first `/trade` run.

## Repository structure

```
scripts/            CLI tools the skill agent calls
adapters/           Market API adapters (instrument discovery)
references/         Supplementary docs loaded by SKILL.md
openclaw-plugin/    OpenClaw wrapper for fast acknowledgment
docs/install/       Client-specific install guides
```

## Docs

- [OpenClaw install/update](docs/install/openclaw.md)
- [Claude Code install/update](docs/install/claude-code.md)
- [Codex install/update](docs/install/codex.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
