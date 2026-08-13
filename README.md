# Mnemosyne — Offline Memory Plugin for OpenClaw

> **v1.3.0** — production hardening: comprehensive input validation, structured error handling, 61 tests, Docker support, enhanced CI.

## What It Is

**Mnemosyne** is a **100% offline, local-only** memory plugin for OpenClaw agents. It replaces cloud-dependent memory systems (e.g. Honcho) with a synchronous SQLite backend that lives inside the gateway process.

**Zero network. Zero API keys. Zero cloud. Native to OpenClaw.**

## What's New in v1.3.0

| Change | Before | After |
|--------|--------|-------|
| **Input validation** | No length limits on parameters | All parameters length-bounded (key: 256, value: 16K, query: 1K) |
| **Error handling** | Raw exceptions propagated to agent runtime | Structured `{ isError: true }` responses with error details |
| **Test coverage** | 17 tests | 61 tests (edge cases, integration, concurrent access) |
| **Code coverage** | Unknown | 92% line, 82% branch coverage |
| **Memory prune determinism** | Non-deterministic when timestamps collide | `id DESC` tiebreaker for deterministic pruning |
| **Docker support** | None | Multi-stage Dockerfile with health check and non-root user |
| **CI/CD** | Build + test only | Coverage reporting, security audit, strict typecheck |
| **Documentation** | README + CHANGELOG | + CONTRIBUTING.md, LICENSE, deployment guide, API reference |
| **Tool context** | `sessionId` missing from `ToolRuntimeContext` | Added for fallback session resolution |

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

### Architecture Deep-Dive

#### Data Access Layer (DAL) Pattern

Mnemosyne enforces agent/session isolation through a **ScopedStore** pattern:

- **`src/dal.ts`** is the *only* module that issues SQL against the content tables (`messages`, `memories`, `messages_fts`, `memories_fts`).
- Every `ScopedStore` instance is bound to a concrete `{ agentId, sessionKey }` at construction.
- All queries automatically inject the agent/session filter — cross-agent leaks are *structurally unrepresentable*.
- A [structural test guard](tests/isolation-guard.test.js) fails the build if any other source file touches the content tables.

#### SQLite Configuration

| Pragma | Value | Purpose |
|--------|-------|---------|
| `journal_mode` | WAL | Write-Ahead Logging for concurrent reads + crash safety |
| `foreign_keys` | ON | Enforce referential integrity |
| `auto_vacuum` | INCREMENTAL | Reclaim space without full VACUUM lock |
| `busy_timeout` | 5000ms (configurable) | Wait instead of SQLITE_BUSY on WAL contention |
| `synchronous` | NORMAL | Balance durability and performance |
| `wal_checkpoint(TRUNCATE)` | On startup | Flush dangling WAL frames from unclean shutdown |

#### FTS5 Full-Text Search

- **Tokenizer**: Porter stemmer + Unicode61 + diacritic removal
- **External content tables**: FTS indexes reference the base tables to avoid data duplication
- **Keep-fresh triggers**: INSERT/UPDATE/DELETE on base tables automatically sync the FTS index
- **Guarded rebuild**: FTS is rebuilt only once on first migration (versioned in `mnemosyne_meta`)
- **LIKE fallback**: When `enableFts: false`, all search/recall operations fall back to `LIKE` queries

#### Auto-Pruning

- **Messages**: FIFO per session, keeps N most recent (default: 10,000)
- **Memories**: FIFO per session, keeps N most recent (default: 1,000)
- **Deterministic**: Both prune operations use `ORDER BY timestamp/updated_at DESC, id DESC` for deterministic behavior when timestamps collide

## Core Features

| Feature | How It Works |
|---------|-------------|
| **Auto-capture** | `agent_end` hook fires after every successful turn → messages saved to SQLite |
| **Full-text search** | `mnemosyne_search` — FTS5 with Porter stemming across ALL sessions |
| **Explicit memory** | `mnemosyne_remember` — store key-value facts scoped to session or agent |
| **Cross-session recall** | `mnemosyne_recall(cross_session=true)` — search memories from any session |
| **List** | `mnemosyne_list` — enumerate all stored memories |
| **Forget** | `mnemosyne_forget` — delete a memory by key |
| **Slash command** | `/mnemosyne stats` — shows counts + FTS status |
| **Auto-pruning** | FIFO deletion per session when limits exceeded |
| **WAL mode** | Crash-safe, concurrent-friendly SQLite |
| **Crash recovery** | `wal_checkpoint(TRUNCATE)` flushes pending WAL on startup |
| **Error resilience** | SQLITE_BUSY retry with exponential backoff (3 attempts, max 500ms) |
| **Input validation** | All parameters length-bounded and type-checked |

## Data Model

### `messages` — Auto-captured conversation turns
- `session_key`, `agent_id`, `role` (user/assistant/system), `content`, `timestamp`

### `memories` — Explicit key-value stores
- `session_key + key` — unique composite
- session-scoped memories use the current OpenClaw `sessionKey`
- agent-scoped memories use `agent:<agentId>:global`
- `value`, `timestamp`, `updated_at`

### `sessions` — Metadata ledger
- `message_count`, `memory_count`, `updated_at`

### `messages_fts` / `memories_fts` — FTS5 virtual tables
- Porter stemmer, Unicode61 normalizer, diacritic removal
- Keep-fresh triggers on INSERT/UPDATE/DELETE

## Installation

### Prerequisites
- Node.js 22 LTS. `package.json` declares `>=22 <24` because Node 24 may require local `better-sqlite3` compilation until matching prebuilt binaries are available.
- OpenClaw >= 2026.4.27
- `python3` and `make` (for better-sqlite3 native compilation)

### Bare Metal Installation

#### Step 1: Clone & Build
```bash
git clone https://github.com/smfworks/mnemosyne-openclaw.git
cd mnemosyne-openclaw
npm install
npm run doctor
npm run build
```

#### Step 2: Load Plugin
```bash
openclaw plugin load /full/path/to/mnemosyne-openclaw
```

#### Step 3: Configure
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

#### Step 4: Restart Gateway
```bash
openclaw gateway restart
```

#### Step 5: Verify
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
- SQLite quick_check: ok
```

### Docker Deployment

#### Building the Image
```bash
docker build -t mnemosyne-openclaw .
```

#### Running as a Sidecar

The Mnemosyne Docker image is designed to be volume-mounted into an OpenClaw gateway container, or used as a base image:

```bash
# Option 1: Mount into an OpenClaw container
docker run -d \
  --name openclaw-gateway \
  -v mnemosyne-plugin:/app/plugins/mnemosyne \
  -v mnemosyne-data:/data \
  your-openclaw-image

# Option 2: Docker Compose with shared volume
```

```yaml
# docker-compose.yml
version: "3.8"
services:
  openclaw:
    image: your-openclaw-image
    volumes:
      - mnemosyne-plugin:/plugins/mnemosyne:ro
      - mnemosyne-data:/data/mnemosyne
    environment:
      - MNEMOSYNE_DB_PATH=/data/mnemosyne/mnemosyne.db

volumes:
  mnemosyne-plugin:
  mnemosyne-data:
```

#### Docker Health Check

The Dockerfile includes a built-in health check that verifies the `better-sqlite3` native binding loads and SQLite is functional:

```bash
docker inspect --format='{{.State.Health.Status}}' mnemosyne-openclaw
```

### Health and Maintenance

```
/mnemosyne health
/mnemosyne vacuum
```

- `health` runs SQLite `quick_check` and a passive WAL checkpoint.
- `vacuum` runs `incremental_vacuum` and `wal_checkpoint(TRUNCATE)`.

## Configuration Reference

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `dbPath` | string | `~/.openclaw/memory/mnemosyne.db` | — | Path to SQLite file (`~` expanded) |
| `ownerObserveOthers` | boolean | `true` | — | Capture owner messages alongside agent messages |
| `noisePatterns` | string[] | Built-in + user | — | Patterns that cause a message to be skipped (anchored match) |
| `maxMessagesPerSession` | integer | `10000` | 100–100000 | Auto-pruning: keep N most recent messages per session |
| `maxMemoriesPerSession` | integer | `1000` | 10–10000 | Auto-pruning: keep N most recent explicit memories per session |
| `enableFts` | boolean | `true` | — | Enable FTS5 full-text search (set `false` for resource-constrained deployments) |
| `busyTimeoutMs` | integer | `5000` | 100–60000 | SQLite busy timeout in milliseconds for WAL contention |

### Built-in Noise Patterns
- `HEARTBEAT_OK`
- `cron reminder`
- `scheduled run`
- `[heartbeat]`, `[system]`

## API Reference

All tools are callable by the agent during a conversation. Parameters are validated and length-bounded.

### mnemosyne_remember

Store an explicit key-value memory.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | yes | — | Memory identifier (normalized: trimmed, lowercased, spaces→underscores, max 256 chars) |
| `value` | string | yes | — | Memory value (max 16,384 chars) |
| `scope` | enum | no | `"session"` | `"session"` or `"agent"` |

**Returns:** `{ content: [{ text: "Remembered: key = value (scope)" }], details: { key, value, scope } }`

**Errors:** Returns `{ isError: true }` if key or value is missing/empty, or if key exceeds 256 chars.

### mnemosyne_recall

Recall explicit memories by key or search query.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | no | — | Exact key to look up (normalized) |
| `query` | string | no | — | Fuzzy search term (FTS5 or LIKE fallback) |
| `cross_session` | boolean | no | `false` | Search across all sessions for this agent |
| `limit` | integer | no | `5` | Max results (1–50) |

**Returns:** `{ content: [{ text: "- key: value (scope)" }], details: { count, keys } }`

### mnemosyne_search

Full-text search across all captured conversations and explicit memories.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Search query (max 1,024 chars; multi-word = AND) |
| `source` | enum | no | `"all"` | `"messages"`, `"memories"`, or `"all"` |
| `limit` | integer | no | `10` | Max results (1–50) |

**Returns:** `{ content: [{ text: "Search results..." }], details: { count, query } }`

### mnemosyne_list

List all explicit memories for the current session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | no | `20` | Max results (1–100) |

**Returns:** `{ content: [{ text: "- key: value (scope)" }], details: { count } }`

### mnemosyne_forget

Delete a memory by exact key.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | yes | — | Exact key to delete (normalized) |
| `scope` | enum | no | `"session"` | `"session"`, `"agent"`, or `"all"` |

**Returns:** `{ content: [{ text: "Deleted N memory from scope scope." }], details: { key, scope, deleted } }`

## Tool Usage Examples

### Remember
```
mnemosyne_remember(key="user_name", value="Michael", scope="session")
mnemosyne_remember(key="timezone", value="America/New_York", scope="agent")
```

### Recall by key
```
mnemosyne_recall(key="user_name")
```
By default, recall checks the current session first, then the current agent's agent-wide memory scope.

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
Lists current-session memories plus current-agent memories, with scope labels.

### Forget
```
mnemosyne_forget(key="old_fact")
mnemosyne_forget(key="old_fact", scope="all")
```
`scope` can be `session`, `agent`, or `all`.

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
| Invalid tool parameters | Structured error responses with `isError: true` flag |
| Parameter length abuse | All inputs length-bounded (key: 256, value: 16K, query: 1K) |
| Concurrent access | SQLite WAL handles concurrent reads; better-sqlite3 is synchronous |

## Development

### Build and tests

```bash
npm install
npm run check      # TypeScript type check
npm test           # Build + run all 61 tests
npm run doctor     # Verify native binding + SQLite FTS5
npm run verify     # check + test + doctor (full CI)
```

### Test Coverage

Current coverage (measured with `node --experimental-test-coverage`):

| Module | Line % | Branch % | Function % |
|--------|--------|----------|------------|
| `config.js` | 78% | 38% | 67% |
| `dal.js` | 94% | 92% | 100% |
| `database.js` | 95% | 67% | 100% |
| `helpers.js` | 86% | 65% | 67% |
| `hooks/capture.js` | 80% | 75% | 50% |
| `state.js` | 93% | 75% | 67% |
| `tools/index.js` | 93% | 91% | 93% |
| **Overall** | **92%** | **82%** | **90%** |

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and submission guidelines.

`better-sqlite3` is a native dependency. On Windows, install a Node version with a matching prebuilt `better-sqlite3` binary or install the Visual Studio C++ build tools so `node-gyp` can compile it. If the native binding is unavailable, TypeScript checks still run with:

```bash
npm install --ignore-scripts
npm run check
```

## Why No HTTP Server?

- **Synchronous** — No async/await complexity in hooks; `agent_end` blocks until write completes
- **Single process** — No separate process to monitor, restart, or debug
- **Zero network** — No `localhost:3001` to fail; direct file I/O
- **Transaction safety** — SQLite WAL mode handles crashes gracefully
- **Proven stack** — better-sqlite3 is a production backend used by millions

## File Structure
```
mnemosyne-openclaw/
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
│   ├── database.test.js       ← Schema, CRUD, pruning
│   ├── hardening.test.js      ← Security: agent isolation, FTS, noise filter
│   ├── tools.test.js          ← Tool-level scoped memory behavior
│   ├── edge-cases.test.js     ← Invalid inputs, error paths, limit clamping
│   ├── integration.test.js    ← Full lifecycle, cross-session, FTS-disabled
│   ├── concurrent.test.js    ← Concurrent access, upsert deduplication
│   └── isolation-guard.test.js ← Structural guard: no SQL outside DAL
├── .github/workflows/ci.yml   ← CI: build, test, coverage, audit, typecheck
├── workspace_md/
│   ├── SOUL.md                ← Plugin philosophy
│   ├── AGENTS.md              ← Agent contract
│   └── BOOTSTRAP.md           ← Quick start
├── Dockerfile                 ← Multi-stage container build
├── CONTRIBUTING.md            ← Development guide
├── LICENSE                    ← MIT license
├── openclaw.plugin.json       ← Plugin manifest
├── package.json               ← NPM manifest
└── tsconfig.json              ← TypeScript config
```

## Non-Goals (What This Plugin Does NOT Do)

These features are intentionally excluded to keep Mnemosyne small, safe, and zero-dependency:

| Feature | Status | Rationale |
|---------|--------|-----------|
| **Vector embeddings / semantic search** | ❌ Not planned | Requires ML runtime (ONNX/transformers.js) — violates "zero heavy deps" design goal. FTS5 + stemming provides excellent keyword recall without the complexity |
| **Knowledge graph / entity-relationship DB** | ❌ Not planned | Requires external services (Qdrant, FalkorDB, Neo4j) — violates single-process design. Use a dedicated graph plugin if needed |
| **LLM-based memory curation** | ❌ Not planned here | Memory consolidation should happen in OpenClaw's dreaming pipeline, not inside the storage plugin |
| **At-rest encryption (SQLCipher)** | ❌ Not planned | Use OS-level disk encryption (LUKS/FileVault/BitLocker). SQLCipher breaks `better-sqlite3` native compatibility |
| **npm publishing** | ❌ Not planned | GitHub is the correct distribution channel for OpenClaw plugins. Install via `openclaw plugin load`, not `npm install -g` |
| **Network-based features** | ❌ By design | Zero outbound calls. The plugin has no `fetch()`, no HTTP, no sockets |
| **Config hot-reload** | ❌ By design | OpenClaw manages plugin lifecycle. Config changes require gateway restart — this is the correct pattern |

If you need any of these, they should be separate plugins that read from the same SQLite database.

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
| Tool returns `isError: true` | Check the error message in `details.error`; likely invalid input (empty key/value, or exceeded length limits) |
| Docker health check fails | Verify the `better-sqlite3` native binding compiled correctly in the build stage |
| `npm run doctor` exits with code 1 | Node version outside `>=22 <24` range, or `better-sqlite3` failed to load. Check `node --version` and native compilation prerequisites |

## License

MIT — SMF Works. See [LICENSE](LICENSE).