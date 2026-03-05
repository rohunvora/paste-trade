# CLI Reference

All scripts are one level deep under `scripts/`.

## Core Flow

```bash
bun run scripts/extract.ts "<url>"
bun run scripts/create-source.ts '<json>'
echo '[{...}, {...}]' | bun run scripts/batch-save.ts --run-id <run_id>
bun run scripts/route-check.ts "<ticker>" long --run-id <run_id>
bun run scripts/post.ts --run-id <run_id> '<json>'
bun run scripts/finalize-source.ts --run-id <run_id> '<json>'
```

## Supporting Scripts

```bash
bun run scripts/status.ts "<source_id>" '<json_event>'
bun run scripts/stream-thought.ts --run-id <run_id> "<message>"
bun run scripts/upload-source-text.ts <source_id> --file <path>
```
