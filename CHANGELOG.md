# Changelog

All notable changes to the Mnemosyne OpenClaw plugin.

## [1.3.0] - 2026-08-13

### Added
- **Comprehensive input validation** — all tool parameters are now length-bounded: keys (256 chars), values (16,384 chars), queries (1,024 chars). Prevents abuse and accidental memory bloat.
- **Structured error handling** — all tool `execute` functions wrapped with `withErrorHandling()`. Errors now return `{ isError: true, content, details: { error } }` instead of throwing raw exceptions to the agent runtime.
- **44 new tests** — expanded from 17 to 61 tests across 7 test files:
  - `tests/edge-cases.test.js` (24 tests): invalid inputs, empty queries, parameter validation, error response structure, limit clamping
  - `tests/integration.test.js` (14 tests): full lifecycle, cross-session agent memory, agent isolation, FTS-disabled mode, session key fallback, pruning
  - `tests/concurrent.test.js` (6 tests): concurrent remember/recall/search, cross-session isolation under concurrency, upsert deduplication
- **Dockerfile** — multi-stage build (builder + runtime), health check, non-root user, `MNEMOSYNE_DB_PATH` environment variable
- **CONTRIBUTING.md** — development setup, architecture overview, code style guidelines, testing instructions, PR process, backward compatibility policy, dependency policy
- **LICENSE** — MIT license file (SMF Works)
- **`.dockerignore`** — excludes node_modules, .git, and build artifacts from Docker context
- **CI coverage job** — uses Node 22 built-in `--experimental-test-coverage` with GitHub Steps Summary output
- **CI security audit job** — verifies `better-sqlite3` has no known vulnerabilities (transitive vulns in the openclaw peer dep are out of scope)
- **CI typecheck job** — isolated TypeScript strict mode verification
- **`sessionId` field** — added to `ToolRuntimeContext` and `PluginToolContext` for fallback session resolution

### Fixed
- **Memory prune determinism** — added `id DESC` tiebreaker to the memories prune query (`ORDER BY updated_at DESC, id DESC`), matching the messages prune pattern. Without this, rapid writes with identical timestamps could produce non-deterministic pruning behavior.

### Changed
- **Version bumped to 1.3.0**.
- **README** — comprehensive rewrite with deployment guide (Docker + bare metal), full API reference for all 5 tools, configuration reference table, architecture deep-dive (DAL pattern, SQLite pragmas, FTS5, auto-pruning), test coverage table, and expanded troubleshooting.
- **CI workflow** — enhanced from single build-test job to 4 jobs: build-test (cross-platform matrix), coverage, security-audit, typecheck.

### Test Coverage
- 61 tests, all passing (up from 17)
- 92% line coverage, 82% branch coverage, 90% function coverage

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
