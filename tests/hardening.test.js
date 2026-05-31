import { test } from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginState } from "../dist/state.js";
import { closeDatabase } from "../dist/database.js";
import {
  registerRememberTool,
  registerRecallTool,
  registerSearchTool,
  registerListTool,
} from "../dist/tools/index.js";
import { onAgentEnd } from "../dist/hooks/capture.js";

const TEST_DB = join(tmpdir(), "mnemosyne-hardening-test.db");

function cleanDb() {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(TEST_DB + suffix); } catch { /* not exists */ }
  }
}

function createState(overrides = {}) {
  cleanDb();
  const state = createPluginState({
    dbPath: TEST_DB,
    enableFts: true,
    maxMemoriesPerSession: 10,
    maxMessagesPerSession: 100,
    ...overrides,
  });
  state.ensureInitialized();
  return state;
}

// fnd_tools_03 — remember prune was invalid SQL (OFFSET without LIMIT); it must
// now succeed on every call AND trim to the configured cap.
test("remember succeeds and prunes to the configured cap (OFFSET fix)", async () => {
  const state = createState({ maxMemoriesPerSession: 10 });
  const ctx = { sessionKey: "s1", agentId: "ag1" };
  for (let i = 0; i < 15; i++) {
    const res = await registerRememberTool(state, ctx).execute("c" + i, { key: "k" + i, value: "v" + i });
    assert.match(res.content[0].text, /^Remembered:/); // never throws / reports failure
  }
  const listed = await registerListTool(state, ctx).execute("cl", { limit: 100 });
  assert.strictEqual(listed.details.count, 10, "should retain exactly the cap");
  assert.match(listed.content[0].text, /k14/, "newest memory retained");
  assert.doesNotMatch(listed.content[0].text, /\bk0:/, "oldest memory pruned");
  cleanDb();
});

// fnd_tools_04 — exact-key recall must normalize the same way remember does, so a
// multiword key is recallable by its user-facing form.
test("exact-key recall normalizes multiword keys", async () => {
  const state = createState();
  const ctx = { sessionKey: "s1", agentId: "ag1" };
  await registerRememberTool(state, ctx).execute("c1", { key: "Favorite Color", value: "blue" });
  const recalled = await registerRecallTool(state, ctx).execute("c2", { key: "favorite color" });
  assert.match(recalled.content[0].text, /favorite_color: blue/);
  cleanDb();
});

// fnd_tools_02 — cross_session recall must not leak another agent's memories.
test("cross_session recall is scoped to the calling agent", async () => {
  const state = createState();
  await registerRememberTool(state, { sessionKey: "sA", agentId: "agA" })
    .execute("c1", { key: "secret", value: "apple-A" });
  const recalled = await registerRecallTool(state, { sessionKey: "sB", agentId: "agB" })
    .execute("c2", { query: "apple", cross_session: true });
  assert.match(recalled.content[0].text, /No memories found/, "agent B must not see agent A's memory");
  cleanDb();
});

// fnd_tools_01 — search must not leak another agent's content, but must find the
// caller's own.
test("search is scoped to the calling agent", async () => {
  const state = createState();
  await registerRememberTool(state, { sessionKey: "sA", agentId: "agA" })
    .execute("c1", { key: "fruit", value: "apple-secret" });
  await registerRememberTool(state, { sessionKey: "sB", agentId: "agB" })
    .execute("c2", { key: "fruit", value: "banana-mine" });

  const leak = await registerSearchTool(state, { sessionKey: "sB", agentId: "agB" })
    .execute("c3", { query: "apple", source: "memories" });
  assert.match(leak.content[0].text, /No results found/, "agent B must not search agent A's content");

  const own = await registerSearchTool(state, { sessionKey: "sB", agentId: "agB" })
    .execute("c4", { query: "banana", source: "memories" });
  assert.match(own.content[0].text, /banana-mine/, "agent B must find its own content");
  cleanDb();
});

// fnd_tools_06 — search must not crash when FTS is disabled; it falls back to LIKE.
test("search works with FTS disabled (LIKE fallback)", async () => {
  const state = createState({ enableFts: false });
  const ctx = { sessionKey: "s1", agentId: "ag1" };
  await registerRememberTool(state, ctx).execute("c1", { key: "topic", value: "quantum widgets" });
  const res = await registerSearchTool(state, ctx).execute("c2", { query: "widgets", source: "memories" });
  assert.match(res.content[0].text, /quantum widgets/);
  cleanDb();
});

// fnd_capture_01 — large-session prune must not blow the SQLite parameter limit
// and must trim to the cap.
test("capture prunes large sessions without parameter-limit errors", async () => {
  const state = createState({ maxMessagesPerSession: 100 });
  const messages = [];
  for (let i = 0; i < 130; i++) {
    messages.push({ role: "user", content: "message number " + i, timestamp: Date.now() + i });
  }
  await onAgentEnd({ success: true, messages }, { sessionKey: "s1", agentId: "ag1" }, state);
  const row = state.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE session_key = ?").get("s1");
  assert.strictEqual(row.c, 100, "session pruned down to the cap");
  cleanDb();
});

// fnd_capture_03 — system-role messages must not be persisted.
test("system-role messages are not captured", async () => {
  const state = createState();
  const messages = [
    { role: "system", content: "SECRET SYSTEM PROMPT do not store", timestamp: Date.now() },
    { role: "user", content: "hello there", timestamp: Date.now() },
    { role: "assistant", content: "hi back", timestamp: Date.now() },
  ];
  await onAgentEnd({ success: true, messages }, { sessionKey: "s1", agentId: "ag1" }, state);
  const rows = state.db.prepare("SELECT role, content FROM messages WHERE session_key = ?").all("s1");
  assert.strictEqual(rows.length, 2, "only user + assistant captured");
  assert.ok(!rows.some((r) => r.role === "system"), "no system row");
  assert.ok(!rows.some((r) => r.content.includes("SECRET SYSTEM PROMPT")), "system content not stored");
  cleanDb();
});

// fnd_capture_04 — anchored noise filter keeps a real turn that merely quotes a
// marker mid-text, but still drops a genuine leading-marker noise turn.
test("noise filter is anchored (startsWith), not substring", async () => {
  const state = createState();
  const messages = [
    { role: "user", content: "[heartbeat] ping", timestamp: Date.now() },            // dropped (leading marker)
    { role: "assistant", content: "I saw the [heartbeat] flag in the log", timestamp: Date.now() }, // kept
  ];
  await onAgentEnd({ success: true, messages }, { sessionKey: "s1", agentId: "ag1" }, state);
  const rows = state.db.prepare("SELECT content FROM messages WHERE session_key = ?").all("s1");
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].content, /I saw the \[heartbeat\] flag/);
  cleanDb();
});
