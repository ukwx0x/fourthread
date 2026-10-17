# Changelog

All notable changes to this project are documented here.

## [0.2.0] — 2026-10-17

M5 vertical slice: tools + adapter hardening.

### Added
- Tool system (`src/tools.ts`): a tool is `{name, description, schema, run}`;
  `ToolRegistry` (register/describe/runCall) with three built-ins —
  `fs.read`, `fs.write` (sandboxed to the workspace root, traversal-resisting
  via `safePath`), and `mem.append` (writes long-term memory through the
  existing deduped fact store).
- Bots invoke tools by emitting `@tool <name> <args-json>` lines; the loop
  parses them (max 3 / reply, malformed ones ignored), executes them, appends
  a visible `tool results for <bot>` turn to the shared thread, and calls the
  bot once more per round (max 2 tool rounds) so it can act on the results.
- `ScriptedAdapter`: offline scriptable adapter for tests (queued replies,
  `$BOT`/`$MODEL` substitution).

### Changed
- `OpenAICompatibleAdapter` is now retry/timeout-aware: per-request
  `AbortSignal.timeout` (default 30 s), retries with exponential backoff on
  429/5xx and network failures (default 3 attempts), throws immediately on
  non-retryable statuses; `fetchImpl` injectable for offline tests.

### Tests
- 19 tests (11 new): tool-call parsing, sandbox escape rejection,
  fs roundtrip, mem.append→SQLite, unknown tool error shape, registry
  describe, loop wiring (results land in the shared thread), adapter
  retry-on-5xx, no-retry-on-401, network-failure retry limit, timeout abort.

## [0.1.0] — 2026-10-11

Initial vertical slice (milestones 1–4 of spec v0.1).

### Added
- `checkpoint_v1` JSON schema (task_intent, next_step, file_watchlist,
  approvals, parent_session_id, turns) with SQLite persistence
  (WAL mode, commit-per-turn).
- `fourthread.yaml` config: per-bot `endpoint`/`model`/`temperature`/
  `maxTokens` + `safety` section with local-first defaults; `fourthread init`
  writes it.
- `ModelAdapter` for any OpenAI-compatible `/chat/completions` endpoint, plus
  an offline `MockAdapter`.
- 4-bot loop: Chief plans → specialists execute in order → Chief summarizes;
  every turn persisted on write.
- Memory layer: shared `./MEMORY.md` (all bots) + per-bot
  `.fourthread/memory/<bot-id>.md` (owner only), deduped, hydrated from
  SQLite on restart.
- Interactive REPL (`fourthread`) with per-turn persistence.
- Vitest suite covering acceptance criteria 1–6 (offline portions); criterion
  against live models marked UNVERIFIED in this release.

### Notes
- Storage uses the built-in `node:sqlite` (Node ≥22) instead of
  `better-sqlite3`; environment toolchains fail to build the native module on
  Node 26 and the built-in removes a native dependency at $0 cost.
- Milestones 5 (MCP server) and 6 (packaging/SEA binary) deferred.
