import { test } from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginState } from "../dist/state.js";
import { closeDatabase } from "../dist/database.js";
import {
  registerForgetTool,
  registerListTool,
  registerRecallTool,
  registerRememberTool,
  registerSearchTool,
} from "../dist/tools/index.js";
import { onAgentEnd } from "../dist/hooks/capture.js";
import { globalCounts } from "../dist/dal.js";

const TEST_DB = join(tmpdir(), "mnemosyne-integration-test.db");

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
    maxMemoriesPerSession: 50,
    maxMessagesPerSession: 200,
    ...overrides,
  });
  state.ensureInitialized();
  return state;
}

// ── Full lifecycle: capture → search → remember → recall → list → forget ──

test("full lifecycle: capture, search, remember, recall, list, forget", async () => {
  const state = createState();
  const ctx = { sessionKey: "lifecycle-sess", agentId: "lifecycle-agent" };

  // 1. Capture conversation
  await onAgentEnd(
    { success: true, messages: [
      { role: "user", content: "Let's discuss quantum computing", timestamp: Date.now() },
      { role: "assistant", content: "Quantum computing uses qubits for parallel processing", timestamp: Date.now() },
    ]},
    ctx,
    state
  );

  // 2. Search captured messages
  const searchRes = await registerSearchTool(state, ctx).execute("s1", { query: "quantum", source: "messages" });
  assert.ok(!searchRes.isError);
  assert.ok(searchRes.details.count >= 1);
  assert.match(searchRes.content[0].text, /quantum/i);

  // 3. Remember a fact
  const rememberRes = await registerRememberTool(state, ctx).execute("r1", {
    key: "research_topic",
    value: "quantum computing",
    scope: "session",
  });
  assert.ok(!rememberRes.isError);
  assert.match(rememberRes.content[0].text, /Remembered:/);

  // 4. Recall by key
  const recallRes = await registerRecallTool(state, ctx).execute("rc1", { key: "research_topic" });
  assert.ok(!recallRes.isError);
  assert.match(recallRes.content[0].text, /quantum computing/);

  // 5. List memories
  const listRes = await registerListTool(state, ctx).execute("l1", {});
  assert.ok(!listRes.isError);
  assert.ok(listRes.details.count >= 1);

  // 6. Forget
  const forgetRes = await registerForgetTool(state, ctx).execute("f1", { key: "research_topic" });
  assert.ok(!forgetRes.isError);
  assert.strictEqual(forgetRes.details.deleted, 1);

  // 7. Verify it's gone
  const recallAfter = await registerRecallTool(state, ctx).execute("rc2", { key: "research_topic" });
  assert.match(recallAfter.content[0].text, /No memories found/);

  cleanDb();
});

// ── Cross-session agent-scoped memory ──

test("agent-scoped memory persists across sessions and is searchable", async () => {
  const state = createState();
  const ctxA = { sessionKey: "sess-a", agentId: "agent-x" };
  const ctxB = { sessionKey: "sess-b", agentId: "agent-x" };

  // Remember in session A with agent scope
  await registerRememberTool(state, ctxA).execute("c1", {
    key: "preference",
    value: "prefers dark mode",
    scope: "agent",
  });

  // Recall from session B (same agent)
  const recallRes = await registerRecallTool(state, ctxB).execute("c2", { key: "preference" });
  assert.ok(!recallRes.isError);
  assert.match(recallRes.content[0].text, /dark mode/);
  assert.match(recallRes.content[0].text, /\(agent\)/);

  // Search from session B should also find it
  const searchRes = await registerSearchTool(state, ctxB).execute("c3", {
    query: "dark mode",
    source: "memories",
  });
  assert.ok(!searchRes.isError);
  assert.ok(searchRes.details.count >= 1);

  cleanDb();
});

// ── Agent isolation ──

test("agent A cannot recall, search, list, or forget agent B's memories", async () => {
  const state = createState();
  const ctxA = { sessionKey: "sess-a", agentId: "agent-a" };
  const ctxB = { sessionKey: "sess-b", agentId: "agent-b" };

  // Agent A stores a secret
  await registerRememberTool(state, ctxA).execute("c1", {
    key: "secret_key",
    value: "agent-a-secret-value",
    scope: "session",
  });

  // Agent B tries to recall it
  const recallRes = await registerRecallTool(state, ctxB).execute("c2", { key: "secret_key" });
  assert.match(recallRes.content[0].text, /No memories found/);

  // Agent B tries to search for it
  const searchRes = await registerSearchTool(state, ctxB).execute("c3", {
    query: "agent-a-secret",
    source: "all",
  });
  assert.match(searchRes.content[0].text, /No results found/);

  // Agent B tries to list it
  const listRes = await registerListTool(state, ctxB).execute("c4", {});
  assert.match(listRes.content[0].text, /No memories stored yet/);

  // Agent B tries to forget it
  const forgetRes = await registerForgetTool(state, ctxB).execute("c5", { key: "secret_key", scope: "all" });
  assert.strictEqual(forgetRes.details.deleted, 0);

  // Agent A can still recall it
  const verifyRes = await registerRecallTool(state, ctxA).execute("c6", { key: "secret_key" });
  assert.match(verifyRes.content[0].text, /agent-a-secret-value/);

  cleanDb();
});

// ── Capture with FTS search across sessions ──

test("captured messages are searchable across sessions for the same agent", async () => {
  const state = createState();
  const ctxA = { sessionKey: "sess-a", agentId: "shared-agent" };
  const ctxB = { sessionKey: "sess-b", agentId: "shared-agent" };

  // Capture in session A
  await onAgentEnd(
    { success: true, messages: [
      { role: "user", content: "The deployment strategy uses blue-green", timestamp: Date.now() },
    ]},
    ctxA,
    state
  );

  // Search from session B (same agent)
  const searchRes = await registerSearchTool(state, ctxB).execute("c1", {
    query: "blue-green deployment",
    source: "messages",
  });
  assert.ok(!searchRes.isError);
  assert.ok(searchRes.details.count >= 1);
  assert.match(searchRes.content[0].text, /blue-green/i);

  cleanDb();
});

// ── Upsert behavior ──

test("remember with same key updates value instead of creating duplicate", async () => {
  const state = createState();
  const ctx = { sessionKey: "upsert-sess", agentId: "upsert-agent" };

  await registerRememberTool(state, ctx).execute("c1", { key: "status", value: "active" });
  await registerRememberTool(state, ctx).execute("c2", { key: "status", value: "inactive" });

  const listRes = await registerListTool(state, ctx).execute("c3", {});
  assert.strictEqual(listRes.details.count, 1);

  const recallRes = await registerRecallTool(state, ctx).execute("c4", { key: "status" });
  assert.match(recallRes.content[0].text, /inactive/);
  assert.doesNotMatch(recallRes.content[0].text, /\bactive\b/);

  cleanDb();
});

// ── FTS disabled integration ──

test("full lifecycle works with FTS disabled (LIKE fallback)", async () => {
  const state = createState({ enableFts: false });
  const ctx = { sessionKey: "nofts-sess", agentId: "nofts-agent" };

  await registerRememberTool(state, ctx).execute("c1", { key: "topic", value: "machine learning" });

  // Recall by query should work with LIKE
  const recallRes = await registerRecallTool(state, ctx).execute("c2", { query: "machine" });
  assert.ok(!recallRes.isError);
  assert.ok(recallRes.details.count >= 1);

  // Search should work with LIKE
  const searchRes = await registerSearchTool(state, ctx).execute("c3", { query: "learning", source: "memories" });
  assert.ok(!searchRes.isError);
  assert.ok(searchRes.details.count >= 1);

  cleanDb();
});

// ── globalCounts ──

test("globalCounts returns accurate counts after operations", async () => {
  const state = createState();
  const ctx = { sessionKey: "count-sess", agentId: "count-agent" };

  // Initial state
  let counts = globalCounts(state);
  assert.strictEqual(counts.messages, 0);
  assert.strictEqual(counts.memories, 0);
  assert.strictEqual(counts.sessions, 0);

  // Capture messages
  await onAgentEnd(
    { success: true, messages: [
      { role: "user", content: "hello world", timestamp: Date.now() },
      { role: "assistant", content: "hi there", timestamp: Date.now() },
    ]},
    ctx,
    state
  );

  // Remember a fact
  await registerRememberTool(state, ctx).execute("c1", { key: "fact", value: "value" });

  counts = globalCounts(state);
  assert.strictEqual(counts.messages, 2);
  assert.strictEqual(counts.memories, 1);
  assert.strictEqual(counts.sessions, 1);

  cleanDb();
});

// ── Capture with no messages ──

test("onAgentEnd with no messages does nothing", async () => {
  const state = createState();
  const ctx = { sessionKey: "empty-sess", agentId: "empty-agent" };

  await onAgentEnd({ success: true, messages: [] }, ctx, state);

  const counts = globalCounts(state);
  assert.strictEqual(counts.messages, 0);
  assert.strictEqual(counts.sessions, 0);

  cleanDb();
});

// ── Capture with failed agent_end ──

test("onAgentEnd with success=false does not capture", async () => {
  const state = createState();
  const ctx = { sessionKey: "fail-sess", agentId: "fail-agent" };

  await onAgentEnd(
    { success: false, messages: [
      { role: "user", content: "should not be captured", timestamp: Date.now() },
    ]},
    ctx,
    state
  );

  const counts = globalCounts(state);
  assert.strictEqual(counts.messages, 0);

  cleanDb();
});

// ── Session key resolution fallback ──

test("tools work with only sessionId (no sessionKey)", async () => {
  const state = createState();
  const ctx = { sessionId: "fallback-session-id", agentId: "fallback-agent" };

  const res = await registerRememberTool(state, ctx).execute("c1", { key: "test", value: "data" });
  assert.ok(!res.isError);

  const recallRes = await registerRecallTool(state, ctx).execute("c2", { key: "test" });
  assert.ok(!recallRes.isError);
  assert.match(recallRes.content[0].text, /data/);

  cleanDb();
});

test("tools work with no sessionKey or sessionId (uses default)", async () => {
  const state = createState();
  const ctx = { agentId: "default-agent" };

  const res = await registerRememberTool(state, ctx).execute("c1", { key: "test", value: "data" });
  assert.ok(!res.isError);

  const recallRes = await registerRecallTool(state, ctx).execute("c2", { key: "test" });
  assert.ok(!recallRes.isError);
  assert.match(recallRes.content[0].text, /data/);

  cleanDb();
});

// ── Pruning integration ──

test("remember prunes to configured cap across multiple calls", async () => {
  const state = createState({ maxMemoriesPerSession: 10 });
  const ctx = { sessionKey: "prune-sess", agentId: "prune-agent" };

  for (let i = 0; i < 20; i++) {
    await registerRememberTool(state, ctx).execute("c" + i, { key: "k" + i, value: "v" + i });
  }

  const listRes = await registerListTool(state, ctx).execute("c100", { limit: 100 });
  assert.strictEqual(listRes.details.count, 10);
  // Should retain the 10 newest (k10..k19)
  assert.match(listRes.content[0].text, /k19/);
  assert.doesNotMatch(listRes.content[0].text, /\bk0:/);
  assert.doesNotMatch(listRes.content[0].text, /\bk9:/);

  cleanDb();
});