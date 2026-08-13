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
  registerListTool,
  registerSearchTool,
} from "../dist/tools/index.js";
import { onAgentEnd } from "../dist/hooks/capture.js";
import { globalCounts } from "../dist/dal.js";

const TEST_DB = join(tmpdir(), "mnemosyne-concurrent-test.db");

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
    maxMemoriesPerSession: 500,
    maxMessagesPerSession: 1000,
    ...overrides,
  });
  state.ensureInitialized();
  return state;
}

// ── Concurrent remember calls (same session) ──

test("concurrent remember calls to same session all succeed", async () => {
  const state = createState();
  const ctx = { sessionKey: "conc-sess", agentId: "conc-agent" };

  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(
      registerRememberTool(state, ctx).execute("c" + i, { key: "key" + i, value: "value" + i })
    );
  }
  const results = await Promise.all(promises);

  for (const res of results) {
    assert.ok(!res.isError, "no concurrent remember should fail");
  }

  const listRes = await registerListTool(state, ctx).execute("c100", { limit: 100 });
  assert.strictEqual(listRes.details.count, 20);

  cleanDb();
});

// ── Concurrent remember calls (different sessions, same agent) ──

test("concurrent remember calls to different sessions do not interfere", async () => {
  const state = createState();

  const promises = [];
  for (let i = 0; i < 10; i++) {
    const ctx = { sessionKey: "sess-" + i, agentId: "shared-agent" };
    promises.push(
      registerRememberTool(state, ctx).execute("c" + i, { key: "key", value: "val-" + i })
    );
  }
  const results = await Promise.all(promises);

  for (const res of results) {
    assert.ok(!res.isError);
  }

  // Each session should have exactly 1 memory
  for (let i = 0; i < 10; i++) {
    const ctx = { sessionKey: "sess-" + i, agentId: "shared-agent" };
    const listRes = await registerListTool(state, ctx).execute("c" + i, { limit: 10 });
    assert.strictEqual(listRes.details.count, 1, `session ${i} should have 1 memory`);
  }

  cleanDb();
});

// ── Concurrent capture + search ──

test("concurrent capture and search do not deadlock or corrupt", async () => {
  const state = createState();
  const ctx = { sessionKey: "conc-capture-sess", agentId: "conc-capture-agent" };

  // Seed some data first
  await registerRememberTool(state, ctx).execute("c0", { key: "seed", value: "initial data" });

  // Run capture and search concurrently
  const capturePromise = onAgentEnd(
    { success: true, messages: [
      { role: "user", content: "concurrent capture message", timestamp: Date.now() },
      { role: "assistant", content: "concurrent response", timestamp: Date.now() },
    ]},
    ctx,
    state
  );

  const searchPromise = registerSearchTool(state, ctx).execute("c1", {
    query: "initial",
    source: "all",
  });

  const [_, searchRes] = await Promise.all([capturePromise, searchPromise]);
  assert.ok(!searchRes.isError);
  assert.ok(searchRes.details.count >= 1);

  // Verify capture succeeded
  const counts = globalCounts(state);
  assert.ok(counts.messages >= 2);

  cleanDb();
});

// ── Concurrent recall from multiple sessions ──

test("concurrent recall from multiple sessions returns correct scoped results", async () => {
  const state = createState();

  // Seed data in different sessions
  for (let i = 0; i < 5; i++) {
    const ctx = { sessionKey: "recall-sess-" + i, agentId: "recall-agent-" + i };
    await registerRememberTool(state, ctx).execute("seed" + i, {
      key: "data",
      value: "value-for-agent-" + i,
    });
  }

  // Concurrent recall from each session
  const promises = [];
  for (let i = 0; i < 5; i++) {
    const ctx = { sessionKey: "recall-sess-" + i, agentId: "recall-agent-" + i };
    promises.push(registerRecallTool(state, ctx).execute("c" + i, { key: "data" }));
  }
  const results = await Promise.all(promises);

  for (let i = 0; i < 5; i++) {
    assert.ok(!results[i].isError);
    assert.match(results[i].content[0].text, new RegExp("value-for-agent-" + i));
  }

  cleanDb();
});

// ── Sequential rapid operations ──

test("rapid sequential remember+recall cycle is consistent", async () => {
  const state = createState();
  const ctx = { sessionKey: "rapid-sess", agentId: "rapid-agent" };

  for (let i = 0; i < 30; i++) {
    await registerRememberTool(state, ctx).execute("c" + i, { key: "k" + i, value: "v" + i });
    const res = await registerRecallTool(state, ctx).execute("rc" + i, { key: "k" + i });
    assert.ok(!res.isError);
    assert.match(res.content[0].text, new RegExp("v" + i));
  }

  const listRes = await registerListTool(state, ctx).execute("c100", { limit: 100 });
  assert.strictEqual(listRes.details.count, 30);

  cleanDb();
});

// ── Same key upsert under concurrency ──

test("concurrent upserts to same key do not create duplicates", async () => {
  const state = createState();
  const ctx = { sessionKey: "upsert-sess", agentId: "upsert-agent" };

  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(
      registerRememberTool(state, ctx).execute("c" + i, { key: "counter", value: "val-" + i })
    );
  }
  await Promise.all(promises);

  const listRes = await registerListTool(state, ctx).execute("c100", { limit: 100 });
  assert.strictEqual(listRes.details.count, 1, "should have exactly 1 memory (upsert, not duplicate)");

  cleanDb();
});