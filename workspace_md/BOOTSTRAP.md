# Quick Start: Mnemosyne Plugin

## Prerequisites
- Node.js 22+ (tested on v24.14.0)
- OpenClaw >= 2026.4.27
- `python3` and `make` (for better-sqlite3 native compilation)
- Optional: `gcc` / `clang` for native node-gyp builds

## Install
```bash
git clone https://github.com/smfworks/mnemosyne-openclaw.git
cd mnemosyne-openclaw
npm install
npm run build
```

## Load into OpenClaw
```bash
openclaw plugin load /full/path/to/mnemosyne-openclaw
# Plugin manifest is auto-detected from openclaw.plugin.json
```

## Configure
Edit `~/.openclaw/openclaw.json`:
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
          "maxMemoriesPerSession": 1000
        }
      }
    },
    "allow": ["mnemosyne", "memory-core"]
  }
}
```

## Restart Gateway
```bash
openclaw gateway restart
```

## Verify
```
/mnemosyne stats
→ Mnemosyne Stats:
   - Messages: 0
   - Memories: 0
   - DB: /home/.../.openclaw/memory/mnemosyne.db
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
| Hook not firing | Ensure `hooks.allowConversationAccess: true` in the plugin entry (if OpenClaw warns about it) |
