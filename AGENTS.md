# AGENTS.md

## Cursor Cloud specific instructions

### What this is

`mcp-legal-chile` is a single-product, headless **MCP server** (TypeScript/Node, Express 5) exposing Chilean-law tools over an HTTP `/mcp` endpoint (and a stdio transport). There is **no GUI** — verify changes with terminal calls, tests, and the smoke script, not a browser.

### Services

- Only the Node app must run. No local database is required.
- Redis is **optional** (used only if `REDIS_URL` is set); the app falls back to an in-memory LRU cache otherwise. Do not stand up Redis for normal dev/testing.
- Live tools call free public upstreams (LeyChile/BCN, Tribunal Constitucional, OpenAlex, etc.) and require outbound internet. No env vars are required for basic dev (open, keyless access by default).

### Running / testing (commands live in `package.json` scripts)

- Dev server: `npm run dev` → binds `0.0.0.0:3000`, MCP endpoint at `http://127.0.0.1:3000/mcp`, plus `/health`, `/metrics`, `/.well-known/mcp.json`.
- Stdio transport (for MCP client wiring): `npm run stdio` (see `cursor-mcp.example.json`).
- Lint/typecheck/format/build: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`.
- Smoke test against a running server: `SMOKE_BASE=http://127.0.0.1:3000 npm run smoke`.

### Non-obvious caveats

- `npm test` runs `npm run build` first and executes tests against compiled `dist/` (`node --test tests/**/*.test.mjs`). CI runs the same tests directly, so build before testing if you skip `npm test`.
- Upstream LeyChile frequently returns **HTTP 429 (rate limit)**. Tools like `obtener_articulo`/`obtener_norma` then return a graceful "reintenta en ~Ns" message with official fallback URLs — this is expected behavior, not a bug. Retry after the suggested backoff or rely on cached results.
- Because of upstream rate limits/retries, `npm run smoke` and live tool calls can take up to ~90s to complete. Deterministic tools (e.g. `formatear_cita`) return instantly and are good for quick sanity checks.
- `WARMUP_ON_BOOT=1` triggers upstream prefetch on startup; warmup failures logged as `warmup_fail` (429) are harmless.
