# Changelog

All notable changes to the Mnemosyne OpenClaw plugin.

## [1.2.0] - 2026-05-28

### Added
- **Production diagnostics** - `npm run doctor` checks Node version compatibility and `better-sqlite3` native binding health.
- **CI workflow** - GitHub Actions now verifies build, tests, and doctor checks on Windows, macOS, and Linux using Node 22.
- **Runtime health commands** - `/mnemosyne health` runs SQLite `quick_check` and a passive WAL checkpoint; `/mnemosyne vacuum` runs incremental vacuum and truncates the WAL.
- **`busyTimeoutMs` config** - configurable SQLite busy timeout for WAL contention.

### Fixed
- **Agent-scoped explicit memories** - `mnemosyne_remember(scope="agent")` now persists to an agent-wide key (`agent:<agentId>:global`) and is visible across sessions for the same agent.
- **Scoped recall/list/forget** - recall and list include session + current-agent memories; forget supports `session`, `agent`, and `all` scopes.
- **FTS query hardening** - search terms are quoted before being passed to SQLite FTS5.

### Changed
- **Version bumped to 1.2.0**.
- **Production Node range declared as `>=22 <24`** because Node 24 may require local native compilation for `better-sqlite3` until matching prebuilt binaries are available.
- **SQLite pragmas hardened** with `busy_timeout` and `synchronous=NORMAL`.
- Build/test scripts now invoke the local TypeScript compiler consistently.

## [1.1.1] - 2026-05-01

### Changed
- **`mnemosyne_recall` now routes query-based recall through FTS5** - Porter stemming (e.g. "remembering" matches "remember"), ranked results, 10-100x faster than LIKE on large DBs. LIKE path retained as fallback when `enableFts: false`
- **Exact-key recall preserved** - direct SQL index scan, fastest path, unchanged

### Added
- **`SECURITY.md`** - trust model, zero-network architecture guarantees, attack surface analysis, rejected security mechanisms with rationale
- **Non-Goals section in README** - explicitly lists features we intentionally exclude (vector embeddings, knowledge graphs, SQLCipher, npm publishing, config hot-reload)

### Documentation
- README updated with Non-Goals table to prevent future audit confusion
- CHANGELOG reflects both audit responses and v1.1.1 changes

## [1.1.0] - 2026-05-01

### Added
- **`mnemosyne_search` tool** - FTS5 full-text search across all sessions with Porter stemming
- **FTS5 virtual tables** - `messages_fts` and `memories_fts` with keep-fresh triggers
- **WAL checkpoint on startup** - `wal_checkpoint(TRUNCATE)` flushes pending WAL frames for crash recovery
- **Error guards** - `withRetry()` wrapper catches `SQLITE_BUSY` with exponential backoff (3 attempts)
- **Guarded FTS rebuild** - only rebuilds on first migration, skips on subsequent restarts
- **Cross-session recall** - `mnemosyne_recall(cross_session=true)` searches all sessions
- **`enableFts` config flag** - disable FTS5 for resource-constrained deployments
- **Shared `ToolRuntimeContext` type** - extracted to `src/types/runtime.ts`

### Fixed
- **Critical: tool session context bug** - tools no longer write to hardcoded `"default_session"`. All tools now receive real `sessionKey`/`agentId` from OpenClaw's runtime context via the factory pattern.
- **`mnemosyne_forget` output** - fixed broken string concatenation in result message

### Changed
- README updated to v1.1 with architecture diagram, tool usage examples, and reliability guarantees table
- `workspace_md/SOUL.md` and `workspace_md/AGENTS.md` reflect new FTS5 and crash-resilience features
- Config schema now includes `enableFts` property

## [1.0.0] - 2026-04-30

### Added
- Initial release - 100% offline, local SQLite memory plugin for OpenClaw
- `agent_end` hook for automatic conversation capture
- Four tools: `mnemosyne_remember`, `mnemosyne_recall`, `mnemosyne_list`, `mnemosyne_forget`
- `/mnemosyne` slash command with `stats` subcommand
- Session-scoped auto-pruning (FIFO per session)
- SQLite WAL mode with foreign keys and auto-vacuum
- Pure-JS config validation (zero heavy deps)
- Plain object export pattern (no SDK import required)
