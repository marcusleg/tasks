/** Passwords, sessions, sign-in rate limiting and request guards. */
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import { db } from './db.js';
import { config } from './config.js';

const scryptAsync = promisify(scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export const SESSION_COOKIE = 'tasks_session';
export const HINT_COOKIE = 'tasks_signed_in';

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, saltB64, keyB64] = (stored || DUMMY_HASH).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024
  });
  return stored ? timingSafeEqual(key, expected) : false;
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use 8 characters or more for your password.';
  if (password.length > 512) return 'That password is too long.';
  return null;
}

/* ---------- sessions ---------- */

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const DAY = 86400000;

function cookieOptions(maxAgeSeconds) {
  return { path: '/', sameSite: 'Lax', secure: config.secureCookies, maxAge: maxAgeSeconds };
}

export function startSession(c, userId, idToken = null) {
  const token = randomBytes(32).toString('base64url');
  const t = Date.now();
  const expires = t + config.sessionDays * DAY;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, id_token) VALUES (?, ?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    t,
    expires,
    t,
    idToken
  );
  const maxAge = Math.floor((expires - t) / 1000);
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(maxAge), httpOnly: true });
  setCookie(c, HINT_COOKIE, '1', cookieOptions(maxAge));
}

export function endSession(c) {
  const token = getCookie(c, SESSION_COOKIE);
  let row = null;
  if (token) {
    row = db.prepare('SELECT id_token FROM sessions WHERE token_hash = ?').get(sha256(token));
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
  deleteCookie(c, HINT_COOKIE, { path: '/', secure: config.secureCookies });
  return row;
}

/** Looks up the signed-in user; extends the session when it's used (sliding expiry). */
export function currentUser(c) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare('SELECT s.expires_at, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(hash);
  const t = Date.now();
  if (!row || row.expires_at < t) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  if (t - row.last_seen > DAY) {
    const expires = t + config.sessionDays * DAY;
    db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?').run(t, expires, hash);
    const maxAge = Math.floor((expires - t) / 1000);
    setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(maxAge), httpOnly: true });
    setCookie(c, HINT_COOKIE, '1', cookieOptions(maxAge));
  }
  return row;
}

export function cleanupExpired() {
  const t = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM oidc_flows WHERE created_at < ?').run(t - 15 * 60 * 1000);
}

/* ---------- rate limiting (in memory) ---------- */

const attempts = new Map();
const WINDOW = 15 * 60 * 1000;

export function clientIp(c) {
  if (config.trustProxy) {
    const fwd = c.req.header('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    const real = c.req.header('x-real-ip');
    if (real) return real.trim();
  }
  try {
    return getConnInfo(c).remote.address || 'unknown';
  } catch {
    return 'unknown';
  }
}

function bucket(key) {
  const t = Date.now();
  let b = attempts.get(key);
  if (!b || b.reset < t) {
    b = { count: 0, reset: t + WINDOW };
    attempts.set(key, b);
  }
  return b;
}

/** True when this IP (or IP + account) has failed too often recently. */
export function isLimited(ip, identifier) {
  return bucket(`ip:${ip}`).count >= 50 || bucket(`id:${ip}:${identifier.toLowerCase()}`).count >= 10;
}

export function recordFailure(ip, identifier) {
  bucket(`ip:${ip}`).count++;
  bucket(`id:${ip}:${identifier.toLowerCase()}`).count++;
}

export function clearFailures(ip, identifier) {
  attempts.delete(`id:${ip}:${identifier.toLowerCase()}`);
}

setInterval(() => {
  const t = Date.now();
  for (const [k, b] of attempts) if (b.reset < t) attempts.delete(k);
  cleanupExpired();
}, 10 * 60 * 1000).unref();

/* ---------- guards ---------- */

/** Blocks cross-site form posts: API writes must carry our header and come from our own origin. */
export async function csrfGuard(c, next) {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (c.req.header('x-requested-with') !== 'tasks') {
      return c.json({ error: 'csrf', message: 'Request blocked.' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin) {
      const host = c.req.header('x-forwarded-host') && config.trustProxy ? c.req.header('x-forwarded-host') : c.req.header('host');
      let ok = false;
      try {
        const o = new URL(origin);
        ok = o.host === host || o.origin === new URL(config.publicUrl).origin;
      } catch {
        ok = false;
      }
      if (!ok) return c.json({ error: 'csrf', message: 'Request blocked.' }, 403);
    }
  }
  await next();
}

export async function requireUser(c, next) {
  const user = currentUser(c);
  if (!user) return c.json({ error: 'unauthenticated', message: 'Your session has ended. Sign in again.' }, 401);
  c.set('user', user);
  await next();
}
