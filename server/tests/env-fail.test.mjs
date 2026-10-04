/**
 * Phase 4 — env fail-fast verification.
 *
 * AGENTS.md §2.9 / BACKEND_SPEC §2: a missing REQUIRED variable must fail
 * startup clearly, never fall back to mocks. Verified at the unit level
 * (loadEnv) AND at the process level (spawn WITHOUT env → non-zero exit).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal VALID env (values are test-only, never real secrets). */
const validEnv = () => ({
  NODE_ENV: 'test',
  PORT: '3001',
  APP_URL: 'http://localhost:5173',
  BACKEND_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:5173',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  SESSION_SECRET: 'x'.repeat(48),
  SESSION_TTL_MINUTES: '60',
  ADMIN_BOOTSTRAP_EMAIL: 'admin@kshop.test',
});

test('loadEnv throws with a clear message listing missing required variables', () => {
  assert.throws(() => loadEnv({}), /missing required environment variable/i);
  assert.throws(
    () => loadEnv({ SUPABASE_URL: 'https://abc.supabase.co' }),
    /SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SESSION_SECRET|CORS_ORIGINS|APP_URL|BACKEND_URL|ADMIN_BOOTSTRAP_EMAIL/i,
  );
});

test('loadEnv rejects a short SESSION_SECRET', () => {
  assert.throws(() => loadEnv({ ...validEnv(), SESSION_SECRET: 'short' }), /SESSION_SECRET/);
});

test('loadEnv rejects a non-https SUPABASE_URL', () => {
  assert.throws(() => loadEnv({ ...validEnv(), SUPABASE_URL: 'http://abc.supabase.co' }), /https/i);
});

test('loadEnv rejects empty CORS_ORIGINS and non-http origins', () => {
  assert.throws(() => loadEnv({ ...validEnv(), CORS_ORIGINS: '' }), /CORS_ORIGINS/);
  assert.throws(() => loadEnv({ ...validEnv(), CORS_ORIGINS: 'javascript:alert(1)' }), /CORS origin/i);
});

test('loadEnv parses and freezes a valid environment', () => {
  const env = loadEnv(validEnv());
  assert.equal(env.PORT, 3001);
  assert.deepEqual(env.CORS_ORIGINS, ['http://localhost:5173']);
  assert.equal(env.ADMIN_BOOTSTRAP_EMAIL, 'admin@kshop.test');
  assert.equal(env.SESSION_TTL_MINUTES, 60);
  assert.ok(Object.isFrozen(env));
});

test('loadEnv accepts runtime-generated admin password path (empty ADMIN_BOOTSTRAP_PASSWORD)', () => {
  const env = loadEnv({ ...validEnv(), ADMIN_BOOTSTRAP_PASSWORD: '' });
  assert.equal(env.ADMIN_BOOTSTRAP_PASSWORD, null);
});

test('Process exits non-zero with a clear message when booted without an environment', () => {
  // Hermetic: point dotenv at an EMPTY file so the real .env cannot mask it.
  const tempDir = mkdtempSync(path.join(tmpdir(), 'kshop-env-'));
  const emptyEnv = path.join(tempDir, '.env.empty');
  writeFileSync(emptyEnv, '');

  const proc = spawnSync(process.execPath, ['src/index.js'], {
    cwd: SERVER_ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DOTENV_CONFIG_PATH: emptyEnv },
    encoding: 'utf8',
    timeout: 20000,
  });

  assert.notEqual(proc.status, 0, `expected non-zero exit, got ${proc.status}`);
  const output = `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`;
  assert.match(output, /missing required environment variable/i);
  assert.match(output, /SUPABASE_URL/i);
});