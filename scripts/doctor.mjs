#!/usr/bin/env node
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const result = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  checks: {},
};

const major = Number(process.versions.node.split('.')[0]);
result.checks.nodeRange = major >= 22 && major < 24
  ? { ok: true, message: 'Node version is in the supported production range (>=22 <24).' }
  : { ok: false, message: 'Use Node >=22 <24 for production. Node 24 may require local better-sqlite3 compilation.' };

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const quick = db.prepare('PRAGMA quick_check').pluck().get();
  const compileOptions = db.prepare('PRAGMA compile_options').pluck().all();
  db.close();
  result.checks.betterSqlite3 = { ok: true, message: 'better-sqlite3 native binding loaded.' };
  result.checks.sqlite = {
    ok: quick === 'ok',
    quick_check: quick,
    fts5: compileOptions.includes('ENABLE_FTS5'),
  };
} catch (error) {
  result.checks.betterSqlite3 = {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

const ok = Object.values(result.checks).every((check) => check.ok !== false);
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
