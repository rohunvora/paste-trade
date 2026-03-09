# Routing

## Decision Rule

1. Try direct expression first.
2. If direct is unavailable, use a proxy only with explicit reasoning.
3. Keep route decisions consistent with saved thesis evidence.

## Route Output

- `executable`: whether a trade expression is available.
- `selected_expression`: the chosen instrument/platform/ticker.
- `alternatives`: other valid expressions.
- `price_context`: current/source-date pricing context.
- `candidate_routes`: proxy candidates to evaluate when direct fails.
