# Agent Contract: Mnemosyne Plugin v1.1

## Role
Mnemosyne is a **memory slot plugin**. It replaces whatever plugin occupies
`plugins.slots.memory` in `openclaw.json`.

## Slot Contract
OpenClaw's plugin system allows exactly one plugin to claim the `memory` slot.
Mnemosyne claims it via `kind: "memory"` in `openclaw.plugin.json`.

When active:
- `agent_end` hook fires after every successful turn → auto-capture + FTS5 re-index
- `mnemosyne_*` tools are available to all agents in all sessions
- Memory prompt supplement is injected into the system prompt
- WAL checkpoint runs on every startup for crash recovery

When disabled (or another plugin claims the slot):
- Hooks unregister automatically on unload
- Database connection closes gracefully
- SQLite file remains on disk for inspection/backup

## Session Scoping (v1.1 — FIXED)
Tools receive the real `sessionKey` and `agentId` from OpenClaw's runtime context
at registration time. No more hardcoded `"default_session"` ghost writes.

Sessions are isolated — one session cannot read another's memories unless:
- `cross_session: true` is passed to `mnemosyne_recall`
- `mnemosyne_search` searches all sessions by default (FTS5)

## Noise Filtering
Built-in patterns skip these from auto-capture:
- `HEARTBEAT_OK`
- `cron reminder`
- `scheduled run`
- `[heartbeat]`, `[system]`

Users can append custom patterns via config `noisePatterns`.

## Error Guards
All tool operations wrap in `withRetry()` — catches `SQLITE_BUSY` (WAL contention)
and retries with exponential backoff up to 3 attempts. Non-BUSY errors propagate
as standard tool failures so the agent can recover gracefully.

## FTS5 Full-Text Search
- `messages_fts` — indexes all captured conversation content (Porter stemmer)
- `memories_fts` — indexes explicit memory keys + values
- Keep-fresh triggers: `messages_ai`, `messages_ad`, `memories_ai`, `memories_au`, `memories_ad`
- Guarded rebuild: only runs on first migration (empty FTS), not every restart
- Configurable: `enableFts: false` disables FTS entirely for resource-constrained deployments

## Agent Guidelines
- Mnemosyne does **not** use LLM inference. No token costs.
- Mnemosyne runs **synchronously** in the gateway process. No async I/O except SQLite.
- The plugin is safe to load/unload at runtime. No dangling processes.
- The SQLite file is portable — copy it between machines.
- WAL mode means occasional `.db-wal` and `.db-shm` files are normal.
