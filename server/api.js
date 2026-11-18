/** JSON API: sign-in, account, lists and tasks. All data is scoped to the signed-in user. */
import { Hono } from 'hono';
import { config } from './config.js';
import { db, transaction, newId, now, publicUser, userCount, findUserByIdentifier, createUser, usernameTaken, getUser } from './db.js';
import {
  hashPassword,
  verifyPassword,
  passwordProblem,
  startSession,
  endSession,
  currentUser,
  csrfGuard,
  requireUser,
  clientIp,
  isLimited,
  recordFailure,
  clearFailures
} from './auth.js';
import { logoutRedirect } from './oidc.js';
import { cleanRule, anchorRule, alignStart, nextOccurrence } from './recurrence.js';
import { calendarLinkUrl, newCalendarToken } from './calendar-feed.js';

export const api = new Hono();

api.use('*', csrfGuard);

const bad = (c, error, message, status = 400) => c.json({ error, message }, status);

async function body(c) {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    return {};
  }
}

function signupOpen() {
  return config.passwordAuth && (config.allowSignup || userCount() === 0);
}

/* ---------- public ---------- */

api.get('/config', (c) =>
  c.json({
    appName: config.appName,
    passwordAuth: config.passwordAuth,
    signupEnabled: signupOpen(),
    oidc: { enabled: config.oidc.enabled, name: config.oidc.name, autoRedirect: config.oidc.autoRedirect },
    links: config.links
  })
);

api.post('/auth/login', async (c) => {
  if (!config.passwordAuth) return bad(c, 'password_disabled', 'Password sign-in is turned off on this server.', 403);
  const { identifier, password } = await body(c);
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
    return bad(c, 'invalid', 'Enter your email or username and password.');
  }
  const id = identifier.trim();
  const ip = clientIp(c);
  if (isLimited(ip, id)) return bad(c, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.', 429);
  const user = findUserByIdentifier(id);
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok) {
    recordFailure(ip, id);
    return bad(c, 'wrong_credentials', 'Wrong email, username or password. Try again.', 401);
  }
  clearFailures(ip, id);
  startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

api.post('/auth/register', async (c) => {
  if (!signupOpen()) return bad(c, 'signup_disabled', 'New accounts can’t be created here. Ask the server’s administrator.', 403);
  const { identifier, password, name } = await body(c);
  const id = typeof identifier === 'string' ? identifier.trim() : '';
  if (!id || id.length > 254 || /\s/.test(id)) return bad(c, 'invalid_identifier', 'Choose an email or username without spaces.');
  const problem = passwordProblem(password);
  if (problem) return bad(c, 'weak_password', problem);
  const ip = clientIp(c);
  if (isLimited(ip, 'register')) return bad(c, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.', 429);
  recordFailure(ip, 'register'); // counts sign-ups per IP, too
  if (usernameTaken(id)) return bad(c, 'identifier_taken', 'That email or username is already taken. Try another.', 409);
  const user = createUser({
    username: id,
    email: id.includes('@') ? id : null,
    name: typeof name === 'string' ? name.trim().slice(0, 200) : '',
    passwordHash: await hashPassword(password)
  });
  startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

api.post('/auth/logout', async (c) => {
  const row = endSession(c);
  return c.json({ ok: true, redirect: await logoutRedirect(row?.id_token) });
});

api.get('/me', (c) => {
  const user = currentUser(c);
  if (!user) return bad(c, 'unauthenticated', 'Not signed in.', 401);
  return c.json({ user: publicUser(user) });
});

/* ---------- signed in ---------- */

api.use('/auth/password', requireUser);
api.use('/lists/*', requireUser);
api.use('/lists', requireUser);
api.use('/tasks/*', requireUser);
api.use('/tasks', requireUser);

api.post('/auth/password', async (c) => {
  if (!config.passwordAuth) return bad(c, 'password_disabled', 'Password sign-in is turned off on this server.', 403);
  const user = c.get('user');
  const { current, password } = await body(c);
  const problem = passwordProblem(password);
  if (problem) return bad(c, 'weak_password', problem);
  if (user.password_hash && !(await verifyPassword(String(current || ''), user.password_hash))) {
    return bad(c, 'wrong_password', 'Your current password is wrong.', 403);
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
  return c.json({ user: publicUser(getUser(user.id)) });
});

/* lists */

const SORT_MODES = ['manual', 'date', 'priority', 'starred', 'title'];
const PRIORITIES = ['low', 'medium', 'high'];
const cleanPriority = (v) => (PRIORITIES.includes(v) ? v : null);

const listJson = (r) => ({ id: r.id, title: r.title, position: r.position, visible: !!r.visible, sortMode: r.sort_mode, createdAt: r.created_at });

function ownList(c, id) {
  return db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(id, c.get('user').id);
}

function cleanTitle(v, max = 200) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

api.get('/lists', (c) => {
  const rows = db.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY position').all(c.get('user').id);
  return c.json({ lists: rows.map(listJson) });
});

api.post('/lists', async (c) => {
  const title = cleanTitle((await body(c)).title);
  if (!title) return bad(c, 'invalid', 'Give the list a name.');
  const userId = c.get('user').id;
  const max = db.prepare('SELECT MAX(position) AS m FROM lists WHERE user_id = ?').get(userId).m ?? 0;
  const id = newId();
  db.prepare('INSERT INTO lists (id, user_id, title, position, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, title, max + 1, now());
  return c.json({ list: listJson(ownList(c, id)) });
});

api.patch('/lists/:id', async (c) => {
  const list = ownList(c, c.req.param('id'));
  if (!list) return bad(c, 'not_found', 'That list no longer exists.', 404);
  const b = await body(c);
  const title = b.title !== undefined ? cleanTitle(b.title) : list.title;
  if (!title) return bad(c, 'invalid', 'Give the list a name.');
  const visible = b.visible !== undefined ? (b.visible ? 1 : 0) : list.visible;
  const sortMode = SORT_MODES.includes(b.sortMode) ? b.sortMode : list.sort_mode;
  db.prepare('UPDATE lists SET title = ?, visible = ?, sort_mode = ? WHERE id = ?').run(title, visible, sortMode, list.id);
  return c.json({ list: listJson(ownList(c, list.id)) });
});

api.delete('/lists/:id', (c) => {
  const list = ownList(c, c.req.param('id'));
  if (!list) return bad(c, 'not_found', 'That list no longer exists.', 404);
  const count = db.prepare('SELECT COUNT(*) AS n FROM lists WHERE user_id = ?').get(list.user_id).n;
  if (count <= 1) return bad(c, 'last_list', 'You need at least one list.', 409);
  db.prepare('DELETE FROM lists WHERE id = ?').run(list.id);
  return c.json({ ok: true });
});

api.delete('/lists/:id/completed', (c) => {
  const list = ownList(c, c.req.param('id'));
  if (!list) return bad(c, 'not_found', 'That list no longer exists.', 404);
  db.prepare('DELETE FROM tasks WHERE list_id = ? AND completed_at IS NOT NULL').run(list.id);
  return c.json({ ok: true });
});

/* tasks */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const taskJson = (r) => ({
  id: r.id,
  listId: r.list_id,
  parentId: r.parent_id,
  title: r.title,
  notes: r.notes,
  dueDate: r.due_date,
  dueTime: r.due_time,
  starredAt: r.starred_at,
  completedAt: r.completed_at,
  position: r.position,
  priority: r.priority || null,
  seriesId: r.series_id || null,
  repeat: parseRule(r.repeat_rule),
  repeatDone: r.repeat_done || 0,
  nextId: r.next_id || null,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

function parseRule(text) {
  if (!text) return null;
  try {
    return cleanRule(JSON.parse(text));
  } catch {
    return null;
  }
}

function ownTask(c, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, c.get('user').id);
}

function cleanDate(v) {
  return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

function cleanTime(v) {
  return typeof v === 'string' && TIME.test(v) ? v : null;
}

api.get('/tasks', (c) => {
  const rows = db.prepare('SELECT * FROM tasks WHERE user_id = ?').all(c.get('user').id);
  return c.json({ tasks: rows.map(taskJson) });
});

api.post('/tasks', async (c) => {
  const b = await body(c);
  const userId = c.get('user').id;
  const list = ownList(c, b.listId);
  if (!list) return bad(c, 'not_found', 'That list no longer exists.', 404);
  let parentId = null;
  if (b.parentId) {
    const parent = ownTask(c, b.parentId);
    if (!parent || parent.parent_id || parent.list_id !== list.id) return bad(c, 'invalid', 'Subtasks can only be added to a task in the same list.');
    parentId = parent.id;
  }
  const sibling = parentId
    ? db.prepare('SELECT MIN(position) AS lo, MAX(position) AS hi FROM tasks WHERE parent_id = ?').get(parentId)
    : db.prepare('SELECT MIN(position) AS lo, MAX(position) AS hi FROM tasks WHERE list_id = ? AND parent_id IS NULL').get(list.id);
  const position = b.placement === 'bottom' ? (sibling.hi ?? 0) + 1 : (sibling.lo ?? 1) - 1;
  const id = newId();
  const t = now();
  let dueDate = cleanDate(b.dueDate);
  let rule = parentId ? null : cleanRule(b.repeat);
  if (rule) {
    dueDate = alignStart(rule, dueDate || todayKey());
    rule = anchorRule(rule, dueDate);
  }
  db.prepare(
    `INSERT INTO tasks (id, user_id, list_id, parent_id, title, notes, due_date, due_time, starred_at, position, created_at, updated_at, repeat_rule)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    list.id,
    parentId,
    cleanTitle(b.title, 1000),
    typeof b.notes === 'string' ? b.notes.slice(0, 20000) : '',
    dueDate,
    dueDate ? cleanTime(b.dueTime) : null,
    b.starred ? t : null,
    position,
    t,
    t,
    rule ? JSON.stringify(rule) : null
  );
  if (cleanPriority(b.priority)) db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(cleanPriority(b.priority), id);
  return c.json({ task: taskJson(ownTask(c, id)) });
});

api.patch('/tasks/:id', async (c) => {
  const task = ownTask(c, c.req.param('id'));
  if (!task) return bad(c, 'not_found', 'That task no longer exists.', 404);
  const b = await body(c);
  const t = now();
  const next = { ...task };
  if (b.title !== undefined) next.title = cleanTitle(b.title, 1000);
  if (b.notes !== undefined) next.notes = typeof b.notes === 'string' ? b.notes.slice(0, 20000) : '';
  if (b.dueDate !== undefined) {
    next.due_date = cleanDate(b.dueDate);
    if (!next.due_date) next.due_time = null;
  }
  if (b.dueTime !== undefined) next.due_time = next.due_date ? cleanTime(b.dueTime) : null;
  if (b.starred !== undefined) next.starred_at = b.starred ? task.starred_at || t : null;
  if (b.priority !== undefined) next.priority = cleanPriority(b.priority);

  // Repeat rule: only top-level tasks repeat, and a repeating task always has a due date.
  let rule = parseRule(task.repeat_rule);
  if (b.repeat !== undefined) rule = task.parent_id ? null : cleanRule(b.repeat);
  else if (b.dueDate !== undefined && !next.due_date) rule = null; // clearing the date stops repeating
  if (rule) {
    if (!next.due_date) next.due_date = todayKey();
    if (b.repeat !== undefined) next.due_date = alignStart(rule, next.due_date);
    rule = anchorRule(rule, next.due_date);
  }
  next.repeat_rule = rule ? JSON.stringify(rule) : null;

  let created = null;
  let removedId = null;
  const completing = b.completed === true && !task.completed_at;
  const reopening = b.completed === false && !!task.completed_at;
  if (b.completed !== undefined) next.completed_at = b.completed ? task.completed_at || t : null;

  transaction(() => {
    if (completing && rule && next.due_date) {
      const due = nextOccurrence(rule, next.due_date, task.repeat_done || 0);
      if (due) created = spawnOccurrence(task, next, rule, due, t);
      next.next_id = created ? created : null;
    }
    if (reopening && task.next_id) {
      const spawned = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(task.next_id, task.user_id);
      if (spawned && !spawned.completed_at && spawned.created_at === spawned.updated_at) {
        db.prepare('DELETE FROM tasks WHERE id = ?').run(spawned.id);
        removedId = spawned.id;
      }
      next.next_id = null;
    }
    db.prepare(
      'UPDATE tasks SET title = ?, notes = ?, due_date = ?, due_time = ?, starred_at = ?, completed_at = ?, repeat_rule = ?, next_id = ?, updated_at = ? WHERE id = ?'
    ).run(next.title, next.notes, next.due_date, next.due_time, next.starred_at, next.completed_at, next.repeat_rule, next.next_id ?? null, t, task.id);
    if (b.priority !== undefined) db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(next.priority, task.id);
    if (b.completed === true && !task.parent_id) {
      db.prepare('UPDATE tasks SET completed_at = ?, updated_at = ? WHERE parent_id = ? AND completed_at IS NULL').run(t, t, task.id);
    }
    if (b.completed === false && task.parent_id) {
      db.prepare('UPDATE tasks SET completed_at = NULL, updated_at = ? WHERE id = ?').run(t, task.parent_id);
    }
  });
  const createdRows = created
    ? db.prepare('SELECT * FROM tasks WHERE id = ? OR parent_id = ?').all(created, created).map(taskJson)
    : [];
  return c.json({ task: taskJson(ownTask(c, task.id)), created: createdRows, removedId });
});

/** Creates the next occurrence of a repeating task (with fresh copies of its subtasks). Returns its id. */
function spawnOccurrence(task, current, rule, due, t) {
  const id = newId();
  db.prepare(
    `INSERT INTO tasks (id, user_id, list_id, parent_id, title, notes, due_date, due_time, starred_at, completed_at, position, created_at, updated_at, repeat_rule, repeat_done)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
  ).run(id, task.user_id, task.list_id, current.title, current.notes, due, current.due_time, current.starred_at, task.position, t, t, JSON.stringify(rule), (task.repeat_done || 0) + 1);
  db.prepare('UPDATE tasks SET priority = ?, series_id = ? WHERE id = ?').run(current.priority ?? null, task.series_id || task.id, id);
  const subs = db.prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY position').all(task.id);
  for (const s of subs) {
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, notes, due_date, due_time, starred_at, completed_at, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`
    ).run(newId(), s.user_id, s.list_id, id, s.title, s.notes, s.position, t, t);
  }
  return id;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

api.delete('/tasks/:id', (c) => {
  const task = ownTask(c, c.req.param('id'));
  if (!task) return bad(c, 'not_found', 'That task no longer exists.', 404);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  return c.json({ ok: true });
});

/** Undo for deletes: puts back tasks the client still has a copy of. */
api.post('/tasks/restore', async (c) => {
  const { tasks } = await body(c);
  if (!Array.isArray(tasks) || tasks.length > 500) return bad(c, 'invalid', 'Nothing to restore.');
  const userId = c.get('user').id;
  const restored = [];
  const sorted = [...tasks].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
  transaction(() => {
    for (const r of sorted) {
      if (!r || typeof r.id !== 'string' || ownTask(c, r.id)) continue;
      const list = ownList(c, r.listId);
      if (!list) continue;
      const parent = r.parentId ? ownTask(c, r.parentId) : null;
      if (r.parentId && !parent) continue;
      db.prepare(
        `INSERT INTO tasks (id, user_id, list_id, parent_id, title, notes, due_date, due_time, starred_at, completed_at, position, created_at, updated_at, repeat_rule, repeat_done)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        r.id,
        userId,
        list.id,
        parent ? parent.id : null,
        cleanTitle(r.title, 1000),
        typeof r.notes === 'string' ? r.notes.slice(0, 20000) : '',
        cleanDate(r.dueDate),
        cleanDate(r.dueDate) ? cleanTime(r.dueTime) : null,
        typeof r.starredAt === 'string' ? r.starredAt : null,
        typeof r.completedAt === 'string' ? r.completedAt : null,
        Number.isFinite(r.position) ? r.position : 0,
        typeof r.createdAt === 'string' ? r.createdAt : now(),
        now(),
        !parent && cleanRule(r.repeat) ? JSON.stringify(cleanRule(r.repeat)) : null,
        Number.isInteger(r.repeatDone) ? r.repeatDone : 0
      );
      db.prepare('UPDATE tasks SET priority = ?, series_id = ? WHERE id = ?').run(
        cleanPriority(r.priority),
        typeof r.seriesId === 'string' ? r.seriesId : null,
        r.id
      );
      restored.push(taskJson(ownTask(c, r.id)));
    }
  });
  return c.json({ tasks: restored });
});

/** Move a task to a list/parent and rewrite the order of its new siblings. */
api.post('/tasks/:id/move', async (c) => {
  const task = ownTask(c, c.req.param('id'));
  if (!task) return bad(c, 'not_found', 'That task no longer exists.', 404);
  const b = await body(c);
  const list = ownList(c, b.listId);
  if (!list) return bad(c, 'not_found', 'That list no longer exists.', 404);
  let parentId = null;
  if (b.parentId) {
    const parent = ownTask(c, b.parentId);
    if (!parent || parent.parent_id || parent.id === task.id || parent.list_id !== list.id) return bad(c, 'invalid', 'Can’t move the task there.');
    const hasChildren = db.prepare('SELECT 1 FROM tasks WHERE parent_id = ?').get(task.id);
    if (hasChildren) return bad(c, 'invalid', 'A task with subtasks can’t become a subtask.');
    parentId = parent.id;
  }
  const order = Array.isArray(b.order) ? b.order.filter((x) => typeof x === 'string').slice(0, 5000) : [];
  const t = now();
  transaction(() => {
    db.prepare('UPDATE tasks SET list_id = ?, parent_id = ?, updated_at = ? WHERE id = ?').run(list.id, parentId, t, task.id);
    db.prepare('UPDATE tasks SET list_id = ? WHERE parent_id = ?').run(list.id, task.id);
    const update = db.prepare('UPDATE tasks SET position = ? WHERE id = ? AND user_id = ? AND list_id = ? AND parent_id IS ?');
    order.forEach((id, i) => update.run(i + 1, id, task.user_id, list.id, parentId));
  });
  return c.json({ task: taskJson(ownTask(c, task.id)) });
});

/* calendar links */

api.use('/calendar-links', requireUser);
api.use('/calendar-links/*', requireUser);

function linkJson(row) {
  const listIds = db
    .prepare('SELECT cl.list_id FROM calendar_link_lists cl JOIN lists l ON l.id = cl.list_id WHERE cl.link_id = ? ORDER BY l.position')
    .all(row.id)
    .map((r) => r.list_id);
  return {
    id: row.id,
    name: row.name,
    allLists: !!row.all_lists,
    listIds: row.all_lists ? [] : listIds,
    url: calendarLinkUrl(row.token),
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at
  };
}

function ownLink(c, id) {
  return db.prepare('SELECT * FROM calendar_links WHERE id = ? AND user_id = ?').get(id, c.get('user').id);
}

/** Validates a name and the covered Lists; returns { name, allLists, listIds } or an error message. */
function parseLink(c, b, current) {
  const name = b.name !== undefined ? cleanTitle(b.name, 100) : current?.name;
  if (!name) return { error: 'Enter a name.' };
  const allLists = b.allLists !== undefined ? !!b.allLists : b.listIds !== undefined ? false : current ? !!current.all_lists : true;
  let listIds = [];
  if (!allLists) {
    const raw = Array.isArray(b.listIds) ? b.listIds : current ? linkJson(current).listIds : [];
    listIds = [...new Set(raw.filter((x) => typeof x === 'string'))].filter((id) => ownList(c, id));
    if (!listIds.length) return { error: 'Choose at least one list.' };
  }
  return { name, allLists, listIds };
}

function saveLinkLists(linkId, listIds) {
  db.prepare('DELETE FROM calendar_link_lists WHERE link_id = ?').run(linkId);
  const ins = db.prepare('INSERT INTO calendar_link_lists (link_id, list_id) VALUES (?, ?)');
  for (const listId of listIds) ins.run(linkId, listId);
}

api.get('/calendar-links', (c) => {
  const rows = db.prepare('SELECT * FROM calendar_links WHERE user_id = ? ORDER BY created_at').all(c.get('user').id);
  return c.json({ links: rows.map(linkJson) });
});

api.post('/calendar-links', async (c) => {
  const parsed = parseLink(c, await body(c));
  if (parsed.error) return bad(c, 'invalid', parsed.error);
  const id = newId();
  transaction(() => {
    db.prepare('INSERT INTO calendar_links (id, user_id, name, token, all_lists, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      c.get('user').id,
      parsed.name,
      newCalendarToken(),
      parsed.allLists ? 1 : 0,
      now()
    );
    saveLinkLists(id, parsed.listIds);
  });
  return c.json({ link: linkJson(ownLink(c, id)) });
});

api.patch('/calendar-links/:id', async (c) => {
  const link = ownLink(c, c.req.param('id'));
  if (!link) return bad(c, 'not_found', 'That calendar link no longer exists.', 404);
  const parsed = parseLink(c, await body(c), link);
  if (parsed.error) return bad(c, 'invalid', parsed.error);
  transaction(() => {
    db.prepare('UPDATE calendar_links SET name = ?, all_lists = ? WHERE id = ?').run(parsed.name, parsed.allLists ? 1 : 0, link.id);
    saveLinkLists(link.id, parsed.listIds);
  });
  return c.json({ link: linkJson(ownLink(c, link.id)) });
});

api.delete('/calendar-links/:id', (c) => {
  const link = ownLink(c, c.req.param('id'));
  if (!link) return bad(c, 'not_found', 'That calendar link no longer exists.', 404);
  db.prepare('DELETE FROM calendar_links WHERE id = ?').run(link.id);
  return c.json({ ok: true });
});

api.notFound((c) => bad(c, 'not_found', 'Not found.', 404));
api.onError((err, c) => {
  console.error(err);
  return bad(c, 'server_error', 'Something went wrong on the server. Try again.', 500);
});
