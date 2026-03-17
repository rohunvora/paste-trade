# CLI Reference

All scripts are one level deep under `skill/scripts/`.

## Core Flow

```bash
bun run skill/scripts/extract.ts "<url>"
bun run skill/scripts/create-source.ts '<json>'
echo '[{...}, {...}]' | bun run skill/scripts/batch-save.ts --run-id <run_id>
bun run skill/scripts/route.ts "<ticker>" long --run-id <run_id>
bun run skill/scripts/post.ts --run-id <run_id> '<json>'
bun run skill/scripts/finalize-source.ts --run-id <run_id> '<json>'
```

## Supporting Scripts

```bash
bun run skill/scripts/status.ts "<source_id>" '<json_event>'
bun run skill/scripts/stream-thought.ts --run-id <run_id> "<message>"
bun run skill/scripts/upload-source-text.ts <source_id> --file <path>
```
