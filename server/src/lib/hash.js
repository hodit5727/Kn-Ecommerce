/**
 * Cryptographic helpers — PIN hashing (scrypt), random secrets, reset codes.
 *
 * §5 mandate: PINs are never stored in plaintext; only a strong salted hash
 * exists in the DB. scrypt with per-user random salt + timing-safe compare.
 * All values here are computed at runtime — nothing is hardcoded (§2.9).
 */
import { randomBytes, scryptSync, randomInt, timingSafeEqual, randomUUID, createHash } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** Hash a 4-digit PIN. Returns `scrypt$N$r$p$saltHex$hashHex`. */
export function hashPin(pin) {
  const salt = randomBytes(16);
  const derived = scryptSync(String(pin), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-time PIN verification. Never throws — worst case returns false. */
export function verifyPin(pin, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  try {
    const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    const derived = scryptSync(String(pin), salt, expected.length, { N: n, r, p });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Strong random secret (admin bootstrap password / one-time console print). */
export function generateSecret(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

/** Random 6-digit numeric code (PIN reset tokens are emailed, not stored). */
export function generateResetCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Domain-separated hash for a PIN-reset code (spec §6 step 7/8). The code is
 * bound to the user id + expiry so a hash alone is useless elsewhere; the
 * plaintext code is only ever sent by email, never stored (§2.9).
 */
export function hashResetCode(code, userId, expiresAtISO) {
  return createHash('sha256')
    .update(`${String(code)}|${String(expiresAtISO)}|${String(userId)}`)
    .digest('hex');
}

/** Timing-safe check that a submitted code matches the stored hash. */
export function verifyResetCode(code, userId, expiresAtISO, storedHash) {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  const expected = Buffer.from(hashResetCode(code, userId, expiresAtISO), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export { randomUUID };