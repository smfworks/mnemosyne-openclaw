# Mnemosyne — Offline Memory Plugin v1.1

## Purpose
Mnemosyne is a **100% offline, local-only** memory plugin for OpenClaw.

It replaces cloud-dependent memory systems (e.g. Honcho) with a synchronous SQLite
backend that lives inside the gateway process. No network, no API keys, no cloud.

## Philosophy
- **Privacy**: All data stays on disk, encrypted at rest by your OS disk encryption.
- **Reliability**: SQLite WAL mode + WAL checkpoint on startup + transactions = crash-safe writes.
- **Transparency**: Every message captured, every tool call logged, no black boxes.
- **Coexistence**: QMD (Markdown RAG) continues to work untouched. Mnemosyne
  fills the *session* and *fact* memory layer; QMD fills the *document* layer.

## Architecture
```
┌───────────────────────────────────────────────────────┐
│                 OpenClaw Gateway                      │
│  ┌───────────────────────────────────────────────┐   │
│  │        Mnemosyne Plugin (kind: memory)        │   │
│  │  ┌────────┐  ┌──────────┐  ┌─────────────┐  │   │
│  │  │ hooks/ │  │  tools/  │  │  database   │  │   │
│  │  │ agent_ │  │ remember │  │  SQLite WAL │  │   │
│  │  │ end    │  │ recall   │  │  FTS5       │  │   │
│  │  │ capture│  │ search   │  │  triggers   │  │   │
│  │  │        │  │ list     │  │  auto-prune │  │   │
│  │  │        │  │ forget   │  └─────────────┘  │   │
│  │  └────────┘  └──────────┘                   │   │
│  └───────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────┐   │
│  │        QMD Plugin (untouched)                 │   │
│  │  memory_search, memory_get                    │   │
│  │  Indexes ~/.openclaw/workspace/               │   │
│  └───────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

## Data Model

### messages
Auto-captured conversation turns. One row per message.
- `session_key` — conversation identifier
- `agent_id` — which agent participated
- `role` — user | assistant | system
- `content` — text content
- `timestamp` — ms since epoch

### memories
Explicit key-value stores from `mnemosyne_remember` tool.
- `session_key + key` — unique composite
- `value` — the stored fact
- `updated_at` — last modification time

### sessions
Metadata ledger per session.
- `message_count`, `memory_count`, `updated_at`

### messages_fts / memories_fts
FTS5 virtual tables with Porter stemming, Unicode61 normalizer, and diacritic removal.
Keep-fresh triggers sync on every INSERT/UPDATE/DELETE to the source tables.

## Auto-Pruning
Configuration `maxMessagesPerSession` and `maxMemoriesPerSession` keep
SQLite files bounded. Oldest rows are deleted first (FIFO per session).

## Hook: agent_end
Runs after every successful agent turn. Extracts all messages, filters noise,
transactionally inserts them, updates session stats, prunes if needed.
FTS5 triggers automatically re-index new content.

## Crash Resilience
On every plugin load, `wal_checkpoint(TRUNCATE)` flushes any pending WAL frames
into the main database file. If the gateway crashed mid-write, no data is lost.

## Tools

| Tool | Purpose | Key Params |
|------|---------|------------|
| `mnemosyne_remember` | Store a fact | `key`, `value`, `scope` |
| `mnemosyne_recall` | Retrieve by key/query | `key` or `query`, `cross_session`, `limit` |
| `mnemosyne_search` | FTS5 full-text search | `query`, `source`, `limit` |
| `mnemosyne_list` | Enumerate memories | `limit` |
| `mnemosyne_forget` | Delete a memory | `key` |

## Commands
- `/mnemosyne stats` — show DB counts + FTS status
- `/mnemosyne` — help text

## Installation (any OpenClaw, offline-capable)
```bash
cd /path/to/mnemosyne-plugin
npm install   # only needs better-sqlite3 — compiles native binding
openclaw plugin load ./
openclaw config set plugins.slots.memory mnemosyne
openclaw gateway restart
```
