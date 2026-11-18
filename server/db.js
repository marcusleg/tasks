/** SQLite storage using Node's built-in driver (no native add-ons to compile). */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, 'tasks.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const migrations = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    oidc_issuer TEXT,
    oidc_subject TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (oidc_issuer, oidc_subject)
  );
  CREATE INDEX users_email ON users(email);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    id_token TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE oidc_flows (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position REAL NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    sort_mode TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  );
  CREATE INDEX lists_user ON lists(user_id);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    due_time TEXT,
    starred_at TEXT,
    completed_at TEXT,
    position REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX tasks_user ON tasks(user_id);
  CREATE INDEX tasks_list ON tasks(list_id);
  CREATE INDEX tasks_parent ON tasks(parent_id);
  `,
  `
  ALTER TABLE tasks ADD COLUMN repeat_rule TEXT;
  ALTER TABLE tasks ADD COLUMN repeat_done INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN next_id TEXT;
  `,
  `
  ALTER TABLE tasks ADD COLUMN priority TEXT;
  ALTER TABLE tasks ADD COLUMN series_id TEXT;
  CREATE TABLE calendar_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    all_lists INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT
  );
  CREATE INDEX calendar_links_user ON calendar_links(user_id);
  CREATE TABLE calendar_link_lists (
    link_id TEXT NOT NULL REFERENCES calendar_links(id) ON DELETE CASCADE,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    PRIMARY KEY (link_id, list_id)
  );
  `
];

db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
const current = db.prepare('SELECT version FROM schema_version').get()?.version ?? 0;
for (let v = current; v < migrations.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(migrations[v]);
    if (v === 0) db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v + 1);
    else db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();

/* ---------- users ---------- */

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    name: row.name || '',
    hasPassword: !!row.password_hash,
    provider: row.oidc_subject ? config.oidc.name : null
  };
}

export function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function findUserByIdentifier(identifier) {
  return db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE ORDER BY username = ? COLLATE NOCASE DESC LIMIT 1')
    .get(identifier, identifier, identifier);
}

export function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createUser({ username, email = null, name = '', passwordHash = null, oidcIssuer = null, oidcSubject = null }) {
  const id = newId();
  transaction(() => {
    db.prepare(
      'INSERT INTO users (id, username, email, name, password_hash, oidc_issuer, oidc_subject, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, username, email, name, passwordHash, oidcIssuer, oidcSubject, now());
    db.prepare('INSERT INTO lists (id, user_id, title, position, created_at) VALUES (?, ?, ?, 1, ?)').run(newId(), id, 'My Tasks', now());
  });
  return getUser(id);
}

export function usernameTaken(username) {
  return !!db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(username, username);
}

/** A free username based on `base` (adds -2, -3 … when needed). */
export function freeUsername(base) {
  const clean = (base || 'user').trim().slice(0, 60) || 'user';
  if (!usernameTaken(clean)) return clean;
  for (let i = 2; ; i++) {
    const candidate = `${clean}-${i}`;
    if (!usernameTaken(candidate)) return candidate;
  }
}
