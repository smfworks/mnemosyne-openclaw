/**
 * Mnemosyne SQLite database singleton.
 * Synchronous, WAL-mode, auto-vacuum. Zero network.
 * Includes FTS5 full-text search for cross-session semantic recall.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
let _db = null;
function ensureDir(p) {
    try {
        mkdirSync(p, { recursive: true });
    }
    catch { /* already exists */ }
}
export function getDatabase(cfg) {
    if (_db)
        return _db;
    const dir = dirname(cfg.dbPath);
    ensureDir(dir);
    _db = new Database(cfg.dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma("auto_vacuum = INCREMENTAL");
    // Crash resilience: flush any dangling WAL frames into the main DB
    _db.pragma("wal_checkpoint(TRUNCATE)");
    _db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      agent_id    TEXT NOT NULL DEFAULT 'main',
      role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content     TEXT NOT NULL,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      metadata    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_key, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_agent    ON messages(agent_id, timestamp DESC);
  `);
    _db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      agent_id    TEXT NOT NULL DEFAULT 'main',
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      UNIQUE(session_key, key)
    );
    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_key, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_key     ON memories(key);
  `);
    _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_key TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL DEFAULT 'main',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      message_count INTEGER DEFAULT 0,
      memory_count  INTEGER DEFAULT 0
    );
  `);
    // === FTS5 Full-Text Search ===
    if (cfg.enableFts !== false) {
        _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        session_key UNINDEXED,
        role UNINDEXED,
        content=messages,
        content_rowid=id,
        tokenize='porter unicode61 remove_diacritics 2'
      );
    `);
        _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        key,
        value,
        session_key UNINDEXED,
        content=memories,
        content_rowid=id,
        tokenize='porter unicode61 remove_diacritics 2'
      );
    `);
        // Triggers to keep FTS in sync with the source tables
        _db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, session_key, role)
        VALUES (new.id, new.content, new.session_key, new.role);
      END;
    `);
        _db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, session_key, role)
        VALUES ('delete', old.id, old.content, old.session_key, old.role);
      END;
    `);
        _db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, key, value, session_key)
        VALUES (new.id, new.key, new.value, new.session_key);
      END;
    `);
        // On update, delete old FTS entry then insert new
        _db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, value, session_key)
        VALUES ('delete', old.id, old.key, old.value, old.session_key);
        INSERT INTO memories_fts(rowid, key, value, session_key)
        VALUES (new.id, new.key, new.value, new.session_key);
      END;
    `);
        _db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, value, session_key)
        VALUES ('delete', old.id, old.key, old.value, old.session_key);
      END;
    `);
        // Rebuild FTS index only if empty (avoid startup delay on large DBs after first migration)
        const ftsMsgCount = _db.prepare(`SELECT COUNT(*) as c FROM messages_fts`).get();
        if (ftsMsgCount.c === 0) {
            _db.prepare(`INSERT INTO messages_fts(messages_fts) VALUES (?)`).run("rebuild");
        }
        const ftsMemCount = _db.prepare(`SELECT COUNT(*) as c FROM memories_fts`).get();
        if (ftsMemCount.c === 0) {
            _db.prepare(`INSERT INTO memories_fts(memories_fts) VALUES (?)`).run("rebuild");
        }
    }
    return _db;
}
export function closeDatabase() {
    if (_db) {
        _db.close();
        _db = null;
    }
}
//# sourceMappingURL=database.js.map