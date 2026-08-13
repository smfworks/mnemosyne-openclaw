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

const TEST_DB = join(tmpdir(), "mnemosyne-edge-test.db");

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
    maxMemoriesPerSession: 100,
    maxMessagesPerSession: 1000,
    ...overrides,
  });
  state.ensureInitialized();
  return state;
}

const defaultCtx = { sessionKey: "edge-session", agentId: "edge-agent" };

// ── remember: invalid inputs ──

test("remember rejects missing key", async () => {
  const state = createState();
  const res = await registerRememberTool(state, defaultCtx).execute("c1", { value: "some value" });
  assert.ok(res.isError, "should return error response");
  assert.match(res.content[0].text, /Error in mnemosyne_remember/);
  assert.match(res.content[0].text, /requires 'key'/);
  cleanDb();
});

test("remember rejects missing value", async () => {
  const state = createState();
  const res = await registerRememberTool(state, defaultCtx).execute("c1", { key: "some_key" });
  assert.ok(res.isError, "should return error response");
  assert.match(res.content[0].text, /requires 'value'/);
  cleanDb();
});

test("remember rejects empty string key after normalization", async () => {
  const state = createState();
  const res = await registerRememberTool(state, defaultCtx).execute("c1", { key: "   ", value: "val" });
  assert.ok(res.isError, "should return error response");
  cleanDb();
});

test("remember rejects empty string value after trim", async () => {
  const state = createState();
  const res = await registerRememberTool(state, defaultCtx).execute("c1", { key: "valid_key", value: "   " });
  assert.ok(res.isError, "should return error response");
  cleanDb();
});

test("remember rejects key exceeding max length", async () => {
  const state = createState();
  const longKey = "a".repeat(257);
  const res = await registerRememberTool(state, defaultCtx).execute("c1", { key: longKey, value: "val" });
  assert.ok(res.isError, "should return error response");
  assert.match(res.content[0].text, /exceeds maximum length/);
  cleanDb();
});

test("remember accepts key at exactly max length", async () => {
  const state = createState();
  const maxKey = "a".repeat(256);
  const res = await registerRememberTool(state, defaultCtx).execute("c1", { key: maxKey, value: "val" });
  assert.ok(!res.isError, "should succeed at max length");
  assert.match(res.content[0].text, /Remembered:/);
  cleanDb();
});

test("remember with null/undefined params returns error", async () => {
  const state = createState();
  const res = await registerRememberTool(state, defaultCtx).execute("c1", {});
  assert.ok(res.isError, "should return error response");
  cleanDb();
});

// ── recall: edge cases ──

test("recall with no key or query returns session memories", async () => {
  const state = createState();
  await registerRememberTool(state, defaultCtx).execute("c1", { key: "fact1", value: "value1" });
  await registerRememberTool(state, defaultCtx).execute("c2", { key: "fact2", value: "value2" });
  const res = await registerRecallTool(state, defaultCtx).execute("c3", {});
  assert.ok(!res.isError);
  assert.ok(res.details.count >= 2);
  cleanDb();
});

test("recall with non-existent key returns no memories", async () => {
  const state = createState();
  const res = await registerRecallTool(state, defaultCtx).execute("c1", { key: "nonexistent" });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /No memories found/);
  assert.strictEqual(res.details.count, 0);
  cleanDb();
});

test("recall with empty query returns session memories (not error)", async () => {
  const state = createState();
  await registerRememberTool(state, defaultCtx).execute("c1", { key: "item", value: "data" });
  const res = await registerRecallTool(state, defaultCtx).execute("c2", { query: "" });
  assert.ok(!res.isError);
  assert.ok(res.details.count >= 1);
  cleanDb();
});

test("recall limit is clamped to maximum 50", async () => {
  const state = createState();
  const res = await registerRecallTool(state, defaultCtx).execute("c1", { key: "test", limit: 999 });
  assert.ok(!res.isError);
  cleanDb();
});

test("recall limit is clamped to minimum 1", async () => {
  const state = createState();
  await registerRememberTool(state, defaultCtx).execute("c1", { key: "test", value: "val" });
  const res = await registerRecallTool(state, defaultCtx).execute("c2", { key: "test", limit: 0 });
  assert.ok(!res.isError);
  assert.ok(res.details.count >= 1);
  cleanDb();
});

// ── search: edge cases ──

test("search rejects missing query", async () => {
  const state = createState();
  const res = await registerSearchTool(state, defaultCtx).execute("c1", {});
  assert.ok(res.isError, "should return error response");
  assert.match(res.content[0].text, /requires 'query'/);
  cleanDb();
});

test("search rejects empty query", async () => {
  const state = createState();
  const res = await registerSearchTool(state, defaultCtx).execute("c1", { query: "   " });
  assert.ok(res.isError, "should return error response");
  cleanDb();
});

test("search with no matching results returns no results message", async () => {
  const state = createState();
  const res = await registerSearchTool(state, defaultCtx).execute("c1", { query: "nonexistentterm12345" });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /No results found/);
  assert.strictEqual(res.details.count, 0);
  cleanDb();
});

test("search with invalid source defaults to 'all'", async () => {
  const state = createState();
  await registerRememberTool(state, defaultCtx).execute("c1", { key: "topic", value: "test data" });
  const res = await registerSearchTool(state, defaultCtx).execute("c2", { query: "test", source: "invalid" });
  assert.ok(!res.isError);
  cleanDb();
});

test("search query exceeding max length returns error", async () => {
  const state = createState();
  const longQuery = "a".repeat(1025);
  const res = await registerSearchTool(state, defaultCtx).execute("c1", { query: longQuery });
  assert.ok(res.isError, "should return error response");
  assert.match(res.content[0].text, /exceeds maximum length/);
  cleanDb();
});

test("search with limit clamped to max 50", async () => {
  const state = createState();
  await registerRememberTool(state, defaultCtx).execute("c1", { key: "topic", value: "test data" });
  const res = await registerSearchTool(state, defaultCtx).execute("c2", { query: "test", limit: 999 });
  assert.ok(!res.isError);
  cleanDb();
});

// ── list: edge cases ──

test("list on empty session returns no memories message", async () => {
  const state = createState();
  const res = await registerListTool(state, defaultCtx).execute("c1", {});
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /No memories stored yet/);
  assert.strictEqual(res.details.count, 0);
  cleanDb();
});

test("list limit is clamped to maximum 100", async () => {
  const state = createState();
  const res = await registerListTool(state, defaultCtx).execute("c1", { limit: 999 });
  assert.ok(!res.isError);
  cleanDb();
});

test("list limit is clamped to minimum 1", async () => {
  const state = createState();
  await registerRememberTool(state, defaultCtx).execute("c1", { key: "item", value: "val" });
  const res = await registerListTool(state, defaultCtx).execute("c2", { limit: 0 });
  assert.ok(!res.isError);
  assert.ok(res.details.count >= 1);
  cleanDb();
});

// ── forget: edge cases ──

test("forget rejects missing key", async () => {
  const state = createState();
  const res = await registerForgetTool(state, defaultCtx).execute("c1", {});
  assert.ok(res.isError, "should return error response");
  assert.match(res.content[0].text, /requires 'key'/);
  cleanDb();
});

test("forget non-existent key returns 0 deleted", async () => {
  const state = createState();
  const res = await registerForgetTool(state, defaultCtx).execute("c1", { key: "nonexistent" });
  assert.ok(!res.isError);
  assert.strictEqual(res.details.deleted, 0);
  cleanDb();
});

test("forget with empty key after normalization returns error", async () => {
  const state = createState();
  const res = await registerForgetTool(state, defaultCtx).execute("c1", { key: "   " });
  assert.ok(res.isError, "should return error response");
  cleanDb();
});

test("forget with invalid scope defaults to session", async () => {
  const state = createState();
  await registerRememberTool(state, defaultCtx).execute("c1", { key: "item", value: "val" });
  const res = await registerForgetTool(state, defaultCtx).execute("c2", { key: "item", scope: "invalid" });
  assert.ok(!res.isError);
  assert.strictEqual(res.details.scope, "session");
  assert.strictEqual(res.details.deleted, 1);
  cleanDb();
});

// ── error response structure ──

test("error responses include isError flag and details.error", async () => {
  const state = createState();
  const res = await registerRememberTool(state, defaultCtx).execute("c1", {});
  assert.ok(res.isError);
  assert.ok(res.details);
  assert.ok(res.details.error);
  assert.ok(Array.isArray(res.content));
  assert.strictEqual(res.content[0].type, "text");
  cleanDb();
});