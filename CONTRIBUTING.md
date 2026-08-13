# Contributing to Mnemosyne

Thank you for your interest in contributing to Mnemosyne! This document covers development setup, code style, testing, and submission guidelines.

## Development Setup

### Prerequisites

- **Node.js 22 LTS** (production range: `>=22 <24`)
- **Python 3** and **make** (for `better-sqlite3` native compilation on platforms without prebuilt binaries)
- **OpenClaw >= 2026.4.27** (for runtime testing; not needed for unit tests)

### Getting Started

```bash
git clone https://github.com/smfworks/mnemosyne-openclaw.git
cd mnemosyne-openclaw
npm install
npm run doctor    # verify native binding + SQLite FTS5
npm run build     # compile TypeScript
npm test          # build + run all tests
```

### Useful Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run check` | Type-check only (no emit) |
| `npm test` | Build + run all tests (`node --test`) |
| `npm run doctor` | Diagnose Node version + `better-sqlite3` binding health |
| `npm run verify` | Run check + test + doctor (full CI verification) |

### TypeScript-Only Verification (no native binding)

If `better-sqlite3` cannot compile on your platform, you can still verify types:

```bash
npm install --ignore-scripts
npm run check
```

## Architecture Overview

Mnemosyne follows a **Data Access Layer (DAL) pattern** to enforce agent/session isolation:

```
src/
├── index.ts           ← Plugin entry point (register, hooks, commands)
├── config.ts          ← Config schema + validator (pure JS, zero deps)
├── database.ts        ← SQLite singleton, schema, FTS5, WAL checkpoint
├── state.ts           ← Shared plugin state (dependency injection)
├── helpers.ts         ← Session keys, noise filter, message extraction
├── hooks/capture.ts   ← agent_end handler (auto-capture)
├── tools/index.ts     ← 5 tools: remember, recall, search, list, forget
└── types/
    ├── runtime.ts     ← ToolRuntimeContext (shared)
    ├── better-sqlite3.d.ts
    └── openclaw-sdk.d.ts
```

### Security-Critical Invariant

**Only `src/dal.ts` and `src/database.ts` may issue SQL against the content tables** (`messages`, `memories`, `messages_fts`, `memories_fts`). All other modules access data through `ScopedStore`, which binds every query to the caller's `agentId` + `sessionKey`.

A structural test (`tests/isolation-guard.test.js`) fails the build if any other source file touches these tables. **Do not disable this guard.**

## Code Style

### TypeScript

- **Strict mode** is always on (`tsconfig.json: "strict": true`).
- Use **explicit types** for public interfaces and function signatures.
- Avoid `any` — use `unknown` + type narrowing instead.
- Prefer **parameterized queries** (`?` placeholders + `.prepare().run()`). Never concatenate user input into SQL.
- Use **ES modules** (`"type": "module"` in `package.json`). Import paths must include `.js` extension.

### Error Handling

- Tool handlers must return structured error responses (`{ isError: true, content, details }`) — never throw raw exceptions to the agent runtime.
- Use the `withErrorHandling()` wrapper in `src/tools/index.ts` for all tool `execute` functions.
- Use `withRetry()` for SQLITE_BUSY transient errors (exponential backoff, max 3 retries).

### Input Validation

- All string parameters must be length-bounded (see `MAX_KEY_LENGTH`, `MAX_VALUE_LENGTH`, `MAX_QUERY_LENGTH` in `src/tools/index.ts`).
- Integer parameters must be clamped to valid ranges (use `clampInt()`).
- Config values are validated and clamped in `src/config.ts`.

## Testing

### Test Framework

Tests use **Node.js built-in test runner** (`node:test`) — no external test framework dependency.

### Test Files

| File | Scope |
|------|-------|
| `tests/database.test.js` | Schema, CRUD, pruning at the SQLite level |
| `tests/hardening.test.js` | Security hardening: agent isolation, FTS, noise filter, capture |
| `tests/tools.test.js` | Tool-level scoped memory behavior |
| `tests/edge-cases.test.js` | Invalid inputs, empty queries, error paths, limit clamping |
| `tests/integration.test.js` | Full lifecycle, cross-session, agent isolation, FTS-disabled |
| `tests/concurrent.test.js` | Concurrent access, upsert deduplication, no deadlock |
| `tests/isolation-guard.test.js` | Structural guard: no content-table SQL outside the DAL |

### Writing Tests

- Each test file manages its own temp database (in `os.tmpdir()`).
- Use `cleanDb()` to remove DB + WAL + SHM files between tests.
- Test both **success paths** and **error paths**.
- For concurrent tests, use `Promise.all()` with multiple tool calls.
- Assertions use `node:assert` — prefer `assert.strictEqual`, `assert.match`, `assert.ok`.

### Running Tests

```bash
npm test           # all tests
node --test tests/edge-cases.test.js   # single file
```

## Submitting Changes

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new tool parameter
fix: resolve concurrent upsert race condition
test: add edge-case tests for search tool
docs: update README with deployment guide
chore: bump better-sqlite3 to 12.9.1
```

### Pull Request Process

1. Create a feature branch from `master`.
2. Write tests for any new functionality.
3. Ensure `npm run verify` passes (check + test + doctor).
4. Ensure `npm run check` passes with no type errors.
5. Update `CHANGELOG.md` under an `## [Unreleased]` section.
6. Keep the API backward-compatible unless discussed in an issue first.

### Backward Compatibility

The plugin's tool API (`mnemosyne_remember`, `mnemosyne_recall`, `mnemosyne_search`, `mnemosyne_list`, `mnemosyne_forget`) must remain backward-compatible. New parameters must be optional with sensible defaults.

## Dependency Policy

- **Single runtime dependency**: `better-sqlite3`. Do not add runtime dependencies.
- Dev dependencies: TypeScript types only (`typescript`, `@types/node`, `@types/better-sqlite3`).
- `openclaw` is a peer dependency — never bundle it.

## Docker

A `Dockerfile` is provided for containerized deployment:

```bash
docker build -t mnemosyne-openclaw .
# The image is designed to be volume-mounted into an OpenClaw gateway container
# or used as a base image. See README.md for deployment details.
```

## License

MIT — SMF Works. By contributing, you agree that your contributions will be licensed under the MIT license.