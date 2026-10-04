/**
 * Ops utility: generate a strong admin password and store it in .env as
 * ADMIN_BOOTSTRAP_PASSWORD (updates the line in place, or appends if absent).
 *
 * Usage:  node scripts/set-admin-password.mjs
 * Effect: rewrites the local .env; the password is NEVER printed to stdout —
 *         read it from .env yourself. Next backend boot, ensureAdmin() applies
 *         it to the admin Auth user (create or reset).
 *
 * This respects AGENTS.md §2.9 (no secrets in code or output) — the secret
 * lives only in the git-ignored .env file.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(HERE, '..', '..', '.env');

// URL-safe 32-char secret, same strength as the session secret.
const password = randomBytes(24).toString('base64url');

const raw = readFileSync(envPath, 'utf8');
const lines = raw.split(/\r?\n/);
const lineIndex = lines.findIndex((l) => l.startsWith('ADMIN_BOOTSTRAP_PASSWORD='));

if (lineIndex >= 0) {
  lines[lineIndex] = `ADMIN_BOOTSTRAP_PASSWORD=${password}`;
} else {
  lines.push(`ADMIN_BOOTSTRAP_PASSWORD=${password}`);
}
writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');

console.log('OK: ADMIN_BOOTSTRAP_PASSWORD set in', envPath);
console.log('The password is saved in that file — open .env to retrieve it.');
console.log('It is your 192-bit admin password; it was NOT printed by this tool.');