/**
 * Phase 4 — admin provisioning / recovery unit tests.
 *
 * ensureAdmin() is the only code that touches the admin credentials:
 *  - first boot + empty env password  → strong random password, generated=true
 *  - first boot + env password        → created with it, setByEnv=true
 *  - user EXISTS + env password       → password RESET to it (recovery path)
 *  - user EXISTS + empty env password → untouched, password unknown (null)
 *
 * The recovery path (item 3) is what unblocks a lost generated password from
 * a boot that crashed after createUser.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { ensureAdmin } from '../src/lib/admin.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';

const envFor = (password) => ({
  ADMIN_BOOTSTRAP_EMAIL: 'root@kshop.test',
  ADMIN_BOOTSTRAP_PASSWORD: password,
});

test('first boot + empty env password → generated strong password, gets ADMIN profile', async () => {
  const fake = createFakeSupabase();
  const admin = await ensureAdmin(fake.service, envFor(''));

  assert.equal(admin.email, 'root@kshop.test');
  assert.equal(admin.generated, true);
  assert.equal(admin.setByEnv, false);
  assert.ok(admin.password && admin.password.length >= 24, 'must be a strong random password');

  const storedUser = [...fake._state.users.values()].find((u) => u.email === 'root@kshop.test');
  assert.ok(storedUser, 'auth user must exist');
  assert.equal(fake.helpers.adminPassword(storedUser.id), admin.password, 'password must be stored on the auth user');

  const profile = fake.helpers.getProfile(storedUser.id);
  assert.ok(profile, 'ADMIN profile row must exist');
  assert.equal(profile.role, 'ADMIN');
});

test('first boot + env password → created with that password, not generated', async () => {
  const fake = createFakeSupabase();
  const admin = await ensureAdmin(fake.service, envFor('AdminPass#123'));

  assert.equal(admin.generated, false);
  assert.equal(admin.setByEnv, true);
  assert.equal(admin.password, 'AdminPass#123');

  const id = [...fake._state.users.values()].find((u) => u.email === 'root@kshop.test').id;
  assert.equal(fake.helpers.adminPassword(id), 'AdminPass#123');
});

test('existing admin + env password → password RESET (recovery), profile untouched', async () => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'adm-1', email: 'root@kshop.test' });
  fake.helpers.seedProfile({ id: 'adm-1', email: 'root@kshop.test', role: 'ADMIN', status: 'ACTIVE' });

  const admin = await ensureAdmin(fake.service, envFor('NewAdminPass#456'));

  assert.equal(admin.generated, false);
  assert.equal(admin.setByEnv, true);
  assert.equal(admin.password, 'NewAdminPass#456');
  assert.equal(fake.helpers.adminPassword('adm-1'), 'NewAdminPass#456', 'password must be reset via updateUserById');

  const profile = fake.helpers.getProfile('adm-1');
  assert.equal(profile.role, 'ADMIN', 'profile must be preserved');
});

test('existing admin + no env password → untouched, password unknown (null)', async () => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'adm-1', email: 'root@kshop.test' });
  fake.helpers.seedProfile({ id: 'adm-1', email: 'root@kshop.test', role: 'ADMIN' });

  const admin = await ensureAdmin(fake.service, envFor(''));

  assert.equal(admin.password, null);
  assert.equal(admin.generated, false);
  assert.equal(admin.setByEnv, false);
  assert.equal(fake.helpers.adminPassword('adm-1'), null, 'must NOT overwrite an unknown existing password');
});

test('existing non-admin user promoted to ADMIN when email matches bootstrap', async () => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'adm-9', email: 'root@kshop.test' });
  fake.helpers.seedProfile({ id: 'adm-9', email: 'root@kshop.test', role: 'CUSTOMER', status: 'ACTIVE' });

  const admin = await ensureAdmin(fake.service, envFor('Promote#789'));

  assert.equal(fake.helpers.getProfile('adm-9').role, 'ADMIN', 'role must be promoted server-side');
  assert.equal(admin.email, 'root@kshop.test');
});