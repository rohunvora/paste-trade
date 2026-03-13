# paste-trade-skill

This is a skill for your AI agent. It adds the `/trade` command.

Finds every tradeable thesis in a source and routes each to an executable trade on [paste.trade](https://paste.trade). Works with tweets, podcasts, articles, screenshots, hunches, and market observations.

## Supported clients

- Claude Code
- OpenClaw
- Codex

## Install

Claude Code and Codex only need the `trade` skill itself.

OpenClaw needs one extra OpenClaw-only component: an async command bridge that
acknowledges `/trade` immediately and then hands the real run off in background.
If you are not using OpenClaw, ignore that step completely.

### Claude Code / Codex

Paste the repo URL into your agent:

```
https://github.com/rohunvora/paste-trade-skill
```

### OpenClaw

Paste the repo URL into your agent:

```
https://github.com/rohunvora/paste-trade-skill
```

Then run the wrapper setup from the installed skill directory:

```bash
bash <skill-install-path>/scripts/setup-openclaw-wrapper.sh
```

The agent knows where it installed the skill — use that path.

## Prerequisites

- [Bun](https://bun.sh) runtime
- `yt-dlp` for YouTube extraction — the skill will offer to install it on first run
- See [env.example](env.example) for all environment variables (required and optional)

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

### Claude Code / Codex

Paste the repo URL into your agent again:

```
https://github.com/rohunvora/paste-trade-skill
```

### OpenClaw

Paste the repo URL into your agent again:

```
https://github.com/rohunvora/paste-trade-skill
```

Then rerun wrapper setup from the installed skill directory:

```bash
bash <skill-install-path>/scripts/setup-openclaw-wrapper.sh
```

## Account portability

- Preferred path: use one `PASTE_TRADE_KEY` across OpenClaw, Claude Code, and Codex.
- Fallback for users who already created separate keys: run `bun run scripts/connect.ts` from the account you want to keep.
- X login is optional. It should not block first `/trade` run.

## Repository structure

```
scripts/            CLI tools the skill agent calls
shared/             Utility functions (price canonicalization, sentinel resolution)
adapters/           Market API adapters (instrument discovery, route field parsing)
references/         Supplementary docs loaded by SKILL.md
openclaw-plugin/    OpenClaw-only async command bridge for fast /trade acknowledgment
docs/install/       Client-specific install guides
```

## Docs

- [How it works](ARCHITECTURE.md) — pipeline diagram, field glossary, streaming lifecycle
- [OpenClaw install/update](docs/install/openclaw.md)
- [Claude Code install/update](docs/install/claude-code.md)
- [Codex install/update](docs/install/codex.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
