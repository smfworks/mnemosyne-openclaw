import { test } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

const TEST_DB = "/tmp/mnemosyne-test.db";

function ensureClean() {
  try { rmSync(TEST_DB); } catch { /* not exists */ }
  try { rmSync(TEST_DB + "-wal"); } catch { /* not exists */ }
  try { rmSync(TEST_DB + "-shm"); } catch { /* not exists */ }
  mkdirSync(dirname(TEST_DB), { recursive: true });
}

test("database schema creates tables", () => {
  ensureClean();
  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'main',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'main',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      UNIQUE(session_key, key)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_key TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      message_count INTEGER DEFAULT 0,
      memory_count INTEGER DEFAULT 0
    );
  `);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const names = tables.map((t) => t.name);
  assert.ok(names.includes("messages"), "messages table exists");
  assert.ok(names.includes("memories"), "memories table exists");
  assert.ok(names.includes("sessions"), "sessions table exists");

  db.close();
});

test("message insert + session upsert", () => {
  ensureClean();
  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, session_key TEXT, agent_id TEXT, role TEXT, content TEXT, timestamp INTEGER);`);
  db.exec(`CREATE TABLE sessions (session_key TEXT PRIMARY KEY, agent_id TEXT, updated_at INTEGER, message_count INTEGER DEFAULT 0);`);

  const insert = db.prepare("INSERT INTO messages (session_key, agent_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)");
  const updateSess = db.prepare(`
    INSERT INTO sessions (session_key, agent_id, updated_at, message_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      updated_at = excluded.updated_at,
      message_count = message_count + excluded.message_count
  `);

  db.transaction(() => {
    insert.run("sess_1", "main", "user", "hello", Date.now());
    updateSess.run("sess_1", "main", Date.now(), 1);
  })();

  const sess = db.prepare("SELECT * FROM sessions WHERE session_key = ?").get("sess_1");
  assert.strictEqual(sess.message_count, 1);

  db.close();
});

test("memory upsert + unique constraint", () => {
  ensureClean();
  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE memories (id INTEGER PRIMARY KEY, session_key TEXT, agent_id TEXT, key TEXT, value TEXT, timestamp INTEGER, updated_at INTEGER, UNIQUE(session_key, key));`);

  const stmt = db.prepare(`
    INSERT INTO memories (session_key, agent_id, key, value, timestamp, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_key, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  stmt.run("sess_1", "main", "user_name", "Michael", 1000, 1000);
  stmt.run("sess_1", "main", "user_name", "Mike", 2000, 2000);

  const rows = db.prepare("SELECT key, value FROM memories WHERE session_key = ?").all("sess_1");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].value, "Mike");

  db.close();
});

test("prune old messages FIFO", () => {
  ensureClean();
  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, session_key TEXT, role TEXT, content TEXT, timestamp INTEGER);`);

  const insert = db.prepare("INSERT INTO messages (session_key, role, content, timestamp) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 5; i++) {
    insert.run("sess_1", "user", `msg${i}`, i * 1000);
  }

  // SQLite IN subquery can't have ORDER BY without a wrapper
  // Step 1: collect IDs to keep (3 newest)
  const keepRows = db.prepare("SELECT id FROM messages WHERE session_key = ? ORDER BY timestamp DESC LIMIT ?").all("sess_1", 3);
  const keepIds = keepRows.map((r) => r.id);
  const placeholders = keepIds.map(() => "?").join(",");

  // Step 2: delete everything else for this session
  db.prepare(`DELETE FROM messages WHERE session_key = ? AND id NOT IN (${placeholders})`).run("sess_1", ...keepIds);

  const rows = db.prepare("SELECT content FROM messages WHERE session_key = ? ORDER BY timestamp").all("sess_1");
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map((r) => r.content), ["msg2", "msg3", "msg4"]);

  db.close();
});

console.log("All database tests passed.");
