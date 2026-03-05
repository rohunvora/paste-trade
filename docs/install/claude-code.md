# Claude Code Install and Update

## Install

```bash
npx skills add rohunvora/paste-trade-skill@v2 -a claude-code
```

## Verify

1. `trade` appears in installed skills.
2. `/trade` is recognized.
3. First run returns normal `/trade` output.

## First run

```text
/trade Meta will benefit from open-source AI distribution.
```

X login is optional and should not block first run.

## Update

```bash
npx skills add rohunvora/paste-trade-skill@latest -a claude-code
```

## Account portability

- Preferred: use the same `PASTE_TRADE_KEY` used in your other clients.
- Fallback if keys are split: run `bun run scripts/connect.ts` from the account you want to keep.
