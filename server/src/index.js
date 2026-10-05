/**
 * Boot entry point (Railway: `npm start` in server/).
 *
 * Order matters:
 *   1. Load .env from the project root (or DOTENV_CONFIG_PATH override).
 *   2. Validate env FAIL-FAST — missing required vars → clear exit.
 *   3. Create Supabase clients (anon + service).
 *   4. Provision the ADMIN account BEFORE listening (fails fast with a
 *      pointer to the SQL deploy script if the schema is not applied yet).
 *   5. Start HTTP.
 *
 * Zero secrets in code — everything comes from the environment (§2.9).
 */
import WebSocket from 'ws';
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './config/env.js';
import { createSupabaseClients } from './lib/supabase.js';
import { ensureAdmin } from './lib/admin.js';
import { writeAudit } from './lib/audit.js';
import { ensureStorageBuckets, probeVerificationTables } from './lib/storage-bootstrap.js';
import { describeUpstreamError, isTransientUpstreamError } from './lib/errors.js';
import { createApp } from './app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(HERE, '..', '..');
const envPath = process.env.DOTENV_CONFIG_PATH
  ? process.env.DOTENV_CONFIG_PATH
  : path.join(projectRoot, '.env');
dotenv.config({ path: envPath });

/**
 * A genuinely undeployed schema is fatal: every route would fail anyway, so we
 * exit and print the SQL-deploy pointer. Everything else (network blip, DNS,
 * TLS, upstream 5xx) must NOT be fatal — see the boot block below.
 */
function isMissingSchemaError(err) {
  return /relation "[\w.]+" does not exist|type "user_role" does not exist/i.test(
    err?.message ?? '',
  );
}

try {
  const env = loadEnv(process.env);
  const supabase = createSupabaseClients(env);

  // Provision the ADMIN account BEFORE listening. Two failure classes must be
  // treated differently, and conflating them is an availability bug:
  //
  //   - Schema not applied  -> fatal. Every route would 500 anyway, so fail
  //                            fast and point at the SQL deploy script.
  //   - Supabase unreachable -> NOT fatal. A two-second network blip at boot
  //                            used to kill the process before app.listen(),
  //                            leaving nothing bound to PORT. The dev proxy and
  //                            Railway both surface that refused connection to
  //                            the browser as 500 on EVERY /api/v1 route, so a
  //                            brief outage took the whole storefront down until
  //                            someone manually restarted the backend.
  //
  // On a transient failure we log the real OS cause and start anyway, so every
  // request surfaces an honest per-request error instead (AGENTS.md §2.7, §2.13).
  let admin = null;
  try {
    admin = await ensureAdmin(supabase.service, env);
    if (admin.generated) {
      // Printed exactly once — no copy is stored anywhere.
      console.log('============================================================');
      console.log('ADMIN BOOTSTRAP - generated one-time password (print once):');
      console.log(`  email:    ${admin.email}`);
      console.log(`  password: ${admin.password}`);
      console.log('SAVE IT NOW - it will not be shown again.');
      console.log('============================================================');
    } else if (admin.setByEnv) {
      console.log(`Admin account ready: ${admin.email} (password from ADMIN_BOOTSTRAP_PASSWORD).`);
    } else {
      console.log(`Admin account already exists: ${admin.email}.`);
      console.log('Tip: set ADMIN_BOOTSTRAP_PASSWORD in the environment to reset the admin password.');
    }
    await writeAudit(supabase, {
      actorRole: 'ADMIN',
      action: 'admin.provisioned',
      resourceType: 'profile',
      resourceId: null,
      metadata: { email: admin.email },
    });
  } catch (adminErr) {
    if (isMissingSchemaError(adminErr)) throw adminErr;
    console.error('\n[STARTUP WARNING] admin provisioning did not complete.');
    console.error(`  cause:  ${describeUpstreamError(adminErr)}`);
    console.error(
      isTransientUpstreamError(adminErr)
        ? '  kind:   transient upstream failure (Supabase unreachable).'
        : '  kind:   non-transient Supabase error.',
    );
    console.error('  impact: the API is starting anyway. Requests that need Supabase');
    console.error('          will return an honest error until Supabase responds — no');
    console.error('          mock or empty data is ever substituted (AGENTS.md §2.5/§2.6).');
    console.error('  fix:    restore connectivity, then restart the backend to finish');
    console.error('          provisioning (it is idempotent).');
  }

  // Storage self-healing + missing-schema diagnostics. Neither ever throws —
  // a transient Supabase hiccup at boot must not take the API down (routes
  // still surface honest per-request errors).
  await ensureStorageBuckets(supabase.service, env);
  await probeVerificationTables(supabase.service);

  const app = createApp({ env, supabase });
  app.listen(env.PORT, () => {
    console.log(`K-Shop backend listening on :${env.PORT} (${env.NODE_ENV})`);
  });
} catch (err) {
  console.error('\n[STARTUP FAILED]');
  console.error(err && err.message ? err.message : err);
  if (isMissingSchemaError(err)) {
    console.error('\nThe Supabase schema has not been applied yet. In Supabase Dashboard > SQL Editor,');
    console.error('paste the contents of supabase/apply-production.sql and Run it, then restart.');
  }
  process.exit(1);
}
