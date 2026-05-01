# Security Policy — Mnemosyne OpenClaw Plugin

## Trust Model

Mnemosyne runs **inside the OpenClaw gateway process** as a native plugin (kind: `memory`). It has access to:

- Your conversation history (messages routed through the gateway)
- The SQLite database file at the configured `dbPath`
- Disk I/O in the directory containing the database
- Nothing else

It has **zero network access** by design. There are no outbound HTTP calls, no API keys, no external services. The only dependency is `better-sqlite3`, a synchronous, native SQLite binding with no network surface.

## Architecture Guarantees

| Property | How |
|----------|-----|
| **No network calls** | Zero `fetch()`, `XMLHttpRequest`, `net`, or `http` modules. All data stays on disk |
| **No LLM inference** | No OpenAI/Anthropic/etc. calls. Mnemosyne is deterministic SQL |
| **No telemetry** | No analytics, no crash reporting, no usage tracking. No upstream libraries with telemetry |
| **No secrets handling** | The plugin never reads environment variables, `.env` files, or OpenClaw secrets. Config is read from `openclaw.plugin.json` via the standard plugin API |
| **SQL-safe** | All queries use parameterized statements (`?` placeholders + `.prepare().run()`). No string concatenation for SQL. No injection surface |
| **Input sanitized** | Config values clamped to safe ranges; tool parameters trimmed, lowercased, and enum-restricted; noise patterns type-checked |
| **Crash-safe** | WAL mode + `wal_checkpoint(TRUNCATE)` on startup flushes any pending frames from an unclean shutdown |

## What Mnemosyne Cannot Do

- It cannot make network requests
- It cannot access files outside its configured `dbPath` directory
- It cannot read other plugins' data or configuration
- It cannot execute arbitrary code — all operations are SQLite queries through better-sqlite3
- It cannot persist data outside the SQLite file

## Attack Surface Analysis

| Vector | Status |
|--------|--------|
| **SQL injection** | ✅ Mitigated — 100% parameterized queries |
| **Path traversal** | ✅ Mitigated — `dbPath` resolves through `dirname()` only, no user-controlled subpaths |
| **RCE through native binding** | ⚠️ Theoretical — `better-sqlite3` is a C++ native addon. We trust the upstream maintainers (mature, widely-used library). The binding only exposes `Database.prepare()`, `.run()`, `.get()`, `.all()`, `.exec()`, `.close()`, and pragma |
| **Supply chain (npm)** | ⚠️ Standard — single runtime dependency (`better-sqlite3`). Dev dependencies: TypeScript types only. No transitive runtime deps beyond Node.js built-ins |
| **Denial of service** | ✅ Mitigated — bounded query limits (max 50 results), auto-pruning with configurable caps, FIFO per session |
| **Data exfiltration** | ✅ Mitigated — no network surface. Data never leaves the machine |
| **Config tampering** | ✅ Handled by OpenClaw — plugin config is validated by the gateway before `register()` is called |

## Rejected Security Mechanisms (and Why)

These are commonly suggested but intentionally excluded:

### At-Rest Encryption (SQLCipher)
**Rejected.** The SQLite database lives in `~/.openclaw/memory/`. Full-disk encryption (LUKS, FileVault, BitLocker) already encrypts this at the OS level. Adding SQLCipher would require an OpenSSL native build dependency and break the `better-sqlite3` binary compatibility. No added security for the complexity cost.

### Network Kill-Switch / LOCAL_ONLY Flag
**Rejected.** The plugin already has zero network calls. Adding a `LOCAL_ONLY` boolean flag is security theater — there's nothing to toggle. If a hypothetical future version added optional cloud features, that would be a separate concern with its own security review.

### Config Hot-Reload
**Rejected.** OpenClaw manages plugin lifecycle, including config. The gateway owns `openclaw.json` and rewrites it on state changes. Having the plugin poll or watch the config file creates a race condition with the gateway's own monitoring. Config changes must go through the gateway → plugin restart pathway. This is by design, not a gap.

## Dependency Inventory

### Runtime (1 dependency)
```
better-sqlite3@^12.9.0  — Synchronous SQLite3 binding for Node.js
  ├── bindings           — Resolves native addon paths
  ├── prebuild-install   — Prebuilt binary download (compile fallback)
  └── file-uri-to-path   — File URI conversion
```

### Zero npm dependencies beyond better-sqlite3's own sub-dependencies
No ORMs, no HTTP clients, no crypto libraries, no telemetry packages. The total dependency tree is under 15 packages.

## Reporting a Vulnerability

If you discover a security issue in this plugin, please open a GitHub issue on the repository or contact the maintainer directly at michael@smfworks.com.

Do NOT report security issues in public Discord channels or forums before they are patched.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅ Active |
| 1.0.x   | ❌ Has known `default_session` bug — upgrade to 1.1.x |
| < 1.0   | ❌ Pre-release |
