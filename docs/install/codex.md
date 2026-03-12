# Codex Install and Update

## Install

```bash
npx skills add rohunvora/paste-trade-skill -a codex
```

## Verify

1. `trade` appears in installed skills.
2. `/trade` runs without local path assumptions.
3. First run returns normal `/trade` output.

## First run

```text
/trade US power demand from AI workloads will outperform grid expectations.
```

X login is optional and should not block first run.

## Update

```bash
npx skills add rohunvora/paste-trade-skill -a codex
```

## Account portability

- Preferred: reuse one `PASTE_TRADE_KEY` across clients.
- Fallback if keys are split: run `bun run scripts/connect.ts` from the account you want to keep.
