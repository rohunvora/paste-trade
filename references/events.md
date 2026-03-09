# Events

Accepted event types:

- `status`
- `extraction_complete`
- `thesis_found`
- `thesis_routing` — emitted by route.ts when routing begins for a thesis
- `thesis_routed` — emitted by save.ts on successful route update
- `thesis_dropped` — emitted by save.ts when a thesis is marked unrouted (final)
- `thought` — emitted by stream-thought.ts for narration moments
- `trade_posted` — emitted by post.ts after a trade is posted
- `complete`
- `failed`
