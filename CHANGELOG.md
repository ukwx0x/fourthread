# Changelog

All notable changes to this project are documented here.

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
