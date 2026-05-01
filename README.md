# Mnemosyne — Offline Memory Plugin for OpenClaw

> **v1.1.0** — FTS5 full-text search, crash resilience, and proper session-scoped tools.

## What It Is

**Mnemosyne** is a **100% offline, local-only** memory plugin for OpenClaw agents. It replaces cloud-dependent memory systems (e.g. Honcho) with a synchronous SQLite backend that lives inside the gateway process.

**Zero network. Zero API keys. Zero cloud. Native to OpenClaw.**

## What's New in v1.1

| Change | Before | After |
|--------|--------|-------|
| **Session context** | Tools wrote to ghost `"default_session"` — agents never saw results | Tools receive real `sessionKey`/`agentId` from OpenClaw runtime |
| **Full-text search** | No cross-session search | `mnemosyne_search` with FTS5 + Porter stemming |
| **Crash resilience** | No crash recovery | `wal_checkpoint(TRUNCATE)` on every startup |
| **Error guards** | DB errors propagated raw | Retry on `SQLITE_BUSY` with exponential backoff |
| **Startup speed** | FTS rebuilt every restart | Guarded rebuild — only runs once on first migration |
| **Code quality** | Duplicated `ToolRuntimeContext` in two files | Shared in `src/types/runtime.ts` |

## Architecture at a Glance

```
┌───────────────────────────────────────────────────────┐
│                 OpenClaw Gateway                      │
│  ┌───────────────────────────────────────────────┐   │
│  │        Mnemosyne Plugin (kind: memory)        │   │
│  │  ┌────────┐  ┌──────────┐  ┌─────────────┐  │   │
│  │  │ hooks/ │  │  tools/  │  │  database   │  │   │
│  │  │capture │  │ remember │  │  SQLite WAL │  │   │
│  │  │ agent_ │  │ recall   │  │  FTS5 index │  │   │
│  │  │ end    │  │ search ◀ │  │  auto-prune │  │   │
│  │  │        │  │ list     │  └─────────────┘  │   │
│  │  │        │  │ forget   │                   │   │
│  │  └────────┘  └──────────┘                   │   │
│  └───────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────┐   │
│  │        QMD Plugin (untouched)                 │   │
│  │  memory_search, memory_get                    │   │
│  │  Indexes ~/.openclaw/workspace/               │   │
│  └───────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

## Core Features

| Feature | How It Works |
|---------|-------------|
| **Auto-capture** | `agent_end` hook fires after every successful turn → messages saved to SQLite |
| **Full-text search** | `mnemosyne_search` — FTS5 with Porter stemming across ALL sessions |
| **Explicit memory** | `mnemosyne_remember` — store key-value facts scoped to real session |
| **Cross-session recall** | `mnemosyne_recall(cross_session=true)` — search memories from any session |
| **List** | `mnemosyne_list` — enumerate all stored memories |
| **Forget** | `mnemosyne_forget` — delete a memory by key |
| **Slash command** | `/mnemosyne stats` — shows counts + FTS status |
| **Auto-pruning** | FIFO deletion per session when limits exceeded |
| **WAL mode** | Crash-safe, concurrent-friendly SQLite |
| **Crash recovery** | `wal_checkpoint(TRUNCATE)` flushes pending WAL on startup |

## Data Model

### `messages` — Auto-captured conversation turns
- `session_key`, `agent_id`, `role` (user/assistant/system), `content`, `timestamp`

### `memories` — Explicit key-value stores
- `session_key + key` — unique composite
- `value`, `timestamp`, `updated_at`

### `sessions` — Metadata ledger
- `message_count`, `memory_count`, `updated_at`

### `messages_fts` / `memories_fts` — FTS5 virtual tables
- Porter stemmer, Unicode61 normalizer, diacritic removal
- Keep-fresh triggers on INSERT/UPDATE/DELETE

## Coexistence with QMD (Zero Conflict)

| Layer | System | What It Does | Data Format |
|-------|--------|-------------|-------------|
| **Long-term Document Memory** | **QMD** (unchanged) | Indexes Markdown files — MEMORY.md, DREAMS.md | Files on disk |
| **Session / Structured Memory** | **Mnemosyne** | Captures conversation turns + explicit key-value remembers + FTS5 search | SQLite (`~/.openclaw/memory/mnemosyne.db`) |

QMD tools stay exactly as they are:
- `memory_search` → searches Markdown files ✓
- `memory_get` → reads Markdown files ✓

Mnemosyne adds new tools alongside them:
- `mnemosyne_remember`, `mnemosyne_recall`, `mnemosyne_search`, `mnemosyne_list`, `mnemosyne_forget`

## Installation (Any OpenClaw, Even Offline)

### Prerequisites
- Node.js 22+ (tested on v24.14.0)
- OpenClaw >= 2026.4.27
- `python3` and `make` (for better-sqlite3 native compilation)

### Step 1: Clone & Build
```bash
git clone https://github.com/smfworks/mnemosyne-openclaw.git
cd mnemosyne-openclaw
npm install
npm run build
```

### Step 2: Load Plugin
```bash
openclaw plugin load /full/path/to/mnemosyne-openclaw
```

### Step 3: Configure
```json
{
  "plugins": {
    "slots": { "memory": "mnemosyne" },
    "entries": {
      "mnemosyne": {
        "enabled": true,
        "config": {
          "dbPath": "~/.openclaw/memory/mnemosyne.db",
          "ownerObserveOthers": true,
          "noisePatterns": [],
          "maxMessagesPerSession": 10000,
          "maxMemoriesPerSession": 1000,
          "enableFts": true
        }
      }
    },
    "allow": ["mnemosyne", "memory-core"]
  }
}
```

### Step 4: Restart Gateway
```bash
openclaw gateway restart
```

### Step 5: Verify
```
/mnemosyne stats
```
Expected:
```
Mnemosyne Stats:
- Messages: 0
- Memories: 0
- Sessions: 0
- DB: /home/.../.openclaw/memory/mnemosyne.db
- FTS: enabled
```

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dbPath` | string | `~/.openclaw/memory/mnemosyne.db` | Path to SQLite file |
| `ownerObserveOthers` | boolean | `true` | Capture owner messages alongside agent messages |
| `noisePatterns` | string[] | Built-in + user-defined | Substrings that cause a message to be skipped |
| `maxMessagesPerSession` | integer | 10000 | Auto-pruning: keep N most recent messages per session |
| `maxMemoriesPerSession` | integer | 1000 | Auto-pruning: keep N most recent explicit memories per session |
| `enableFts` | boolean | `true` | Enable FTS5 full-text search indexes (set to `false` to save disk on resource-constrained deployments) |

## Built-in Noise Patterns
- `HEARTBEAT_OK`
- `cron reminder`
- `scheduled run`
- `[heartbeat]`, `[system]`

## Tool Usage (from Agent Prompt)

### Remember
```
mnemosyne_remember(key="user_name", value="Michael", scope="session")
```

### Recall by key
```
mnemosyne_recall(key="user_name")
```

### Recall by query
```
mnemosyne_recall(query="timezone", limit=5)
```

### Cross-session recall
```
mnemosyne_recall(query="plugin", cross_session=true, limit=10)
```

### Full-text search (FTS5)
```
mnemosyne_search(query="Italian wine candles", source="all", limit=10)

# Source filter: "messages" | "memories" | "all"
# Stemming: "remembering" matches "remember", "conversations" matches "conversation"
```

### List all
```
mnemosyne_list(limit=20)
```

### Forget
```
mnemosyne_forget(key="old_fact")
```

## Reliability Guarantees

| Failure Mode | Mitigation |
|-------------|-----------|
| Gateway crash mid-write | SQLite WAL + `wal_checkpoint(TRUNCATE)` on restart |
| Disk full | Graceful degradation; oldest entries pruned |
| Config corruption | Schema validation on every boot; auto-create DB on first run |
| QMD conflict | Completely separate namespaces; QMD tools unaffected |
| Plugin crash on load | Isolated to plugin; gateway stays up; error logged |
| SQLITE_BUSY (WAL contention) | Retry with exponential backoff (3 attempts, max 500ms) |
| Large DB (100K+ messages) | Guarded FTS rebuild — near-zero startup after first migration |

## Why No HTTP Server?

- **Synchronous** — No async/await complexity in hooks; `agent_end` blocks until write completes
- **Single process** — No separate process to monitor, restart, or debug
- **Zero network** — No `localhost:3001` to fail; direct file I/O
- **Transaction safety** — SQLite WAL mode handles crashes gracefully
- **Proven stack** — better-sqlite3 is a production backend used by millions

## File Structure
```
mnemosyne-plugin/
├── dist/                      ← Compiled JS (tsc output)
├── src/
│   ├── index.ts               ← Plugin entry point
│   ├── config.ts              ← Schema + validator
│   ├── database.ts            ← SQLite singleton + FTS5 + WAL checkpoint
│   ├── state.ts               ← Shared plugin state (DI pattern)
│   ├── helpers.ts             ← Session keys, noise filter
│   ├── hooks/
│   │   └── capture.ts         ← agent_end handler
│   ├── tools/
│   │   └── index.ts           ← 5 tools: remember/recall/search/list/forget
│   └── types/
│       ├── runtime.ts         ← ToolRuntimeContext (shared)
│       ├── better-sqlite3.d.ts← Type declarations
│       └── openclaw-sdk.d.ts  ← Plugin API types
├── tests/
│   └── database.test.js       ← Node built-in test runner
├── workspace_md/
│   ├── SOUL.md                ← Plugin philosophy
│   ├── AGENTS.md              ← Agent contract
│   └── BOOTSTRAP.md           ← Quick start
├── openclaw.plugin.json       ← Plugin manifest
├── package.json               ← NPM manifest
└── tsconfig.json              ← TypeScript config
```

## Disable / Revert

```bash
# Re-enable cloud memory (Honcho)
openclaw config set plugins.slots.memory openclaw-honcho
openclaw gateway restart

# Or disable memory slot entirely
openclaw config set plugins.slots.memory ""
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `better-sqlite3` build fails | `npm install --build-from-source` or `NODE_GYP_FORCE_PYTHON=python3 npm install` |
| Gateway won't start after plugin load | Check `plugins.slots.memory` aligns with `plugins.entries.*.enabled`; check logs for schema errors |
| DB grows large | Reduce `maxMessagesPerSession` / `maxMemoriesPerSession` in config |
| Missing tool | Verify `plugins.allow` includes `"mnemosyne"` |
| FTS search returns no results | Check `enableFts: true` in config; `/mnemosyne stats` shows FTS status |
| Empty memories after remember calls | Upgrade from v1.0 — v1.1 fixes the `"default_session"` bug |

## License
MIT — SMF Works
