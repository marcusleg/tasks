/**
 * In-browser stand-in for the server, used when the app is opened without one (for example as a
 * static preview). Same routes and JSON shapes as server/api.js; data lives in localStorage.
 */
import { todayKey, addDays } from './dates.js';
import { cleanRule, anchorRule, alignStart, nextOccurrence } from '../../server/recurrence.js';

const KEY = 'tasks-preview-v1';
const id = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const now = () => new Date().toISOString();

function seed() {
  const t = now();
  const today = todayKey();
  const lists = [
    { id: id(), title: 'My Tasks', position: 1, visible: true, sortMode: 'manual', createdAt: t },
    { id: id(), title: 'Groceries', position: 2, visible: true, sortMode: 'manual', createdAt: t },
    { id: id(), title: 'Work', position: 3, visible: true, sortMode: 'manual', createdAt: t }
  ];
  const tasks = [];
  let pos = 0;
  const add = (list, title, extra = {}) => {
    const task = {
      id: id(),
      listId: list.id,
      parentId: null,
      title,
      notes: '',
      dueDate: null,
      dueTime: null,
      starredAt: null,
      completedAt: null,
      position: ++pos,
      priority: null,
      seriesId: null,
      repeat: null,
      repeatDone: 0,
      nextId: null,
      createdAt: t,
      updatedAt: t,
      ...extra
    };
    tasks.push(task);
    return task;
  };
  const [my, groceries, work] = lists;
  add(my, 'Pay the electricity bill', { dueDate: addDays(today, -1), priority: 'high' });
  const trip = add(my, 'Plan the weekend trip', { priority: 'medium', notes: 'Pick a place, then book travel and a room.', dueDate: addDays(today, 4) });
  add(my, 'Book a hotel', { parentId: trip.id });
  add(my, 'Buy train tickets', { parentId: trip.id, dueDate: addDays(today, 2) });
  add(my, 'Water the plants', { dueDate: addDays(today, 1), starredAt: t, repeat: { freq: 'day', interval: 3, weekdays: [], end: { type: 'never' } } });
  add(my, 'Call the dentist', { completedAt: t });
  for (const title of ['Oat milk', 'Bananas', 'Bread', 'Coffee beans']) add(groceries, title, title === 'Oat milk' ? { priority: 'low' } : {});
  add(work, 'Write the release notes', { dueDate: today, dueTime: '17:00', starredAt: t, priority: 'high' });
  add(work, 'Review pull requests');
  add(work, 'Team sync', {
    dueDate: alignStart({ freq: 'week', weekdays: [1] }, today),
    dueTime: '10:00',
    repeat: { freq: 'week', interval: 1, weekdays: [1], end: { type: 'never' } }
  });
  add(work, 'Quarterly review notes', { dueDate: addDays(today, 9), priority: 'low' });
  return { lists, tasks };
}

let data = null;

function load() {
  if (data) return data;
  try {
    data = JSON.parse(localStorage.getItem(KEY));
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.lists) || !Array.isArray(data.tasks)) data = seed();
  save();
  return data;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: keeps working for this visit */
  }
}

export function resetPreview() {
  data = seed();
  save();
}

class LocalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => {
  throw new LocalError(status, code, message);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const clean = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['low', 'medium', 'high'];
const TIME = /^\d{2}:\d{2}$/;

function list(listId) {
  return load().lists.find((l) => l.id === listId) || fail(404, 'not_found', 'That list no longer exists.');
}

function task(taskId) {
  return load().tasks.find((t) => t.id === taskId) || fail(404, 'not_found', 'That task no longer exists.');
}

export async function localApi(method, path, body = {}) {
  const d = load();
  const parts = path.replace(/^\/api\//, '').split('/');
  const route = `${method} ${parts.map((p, i) => (i === 1 && parts[0] !== 'auth' && p !== 'restore' ? ':id' : p)).join('/')}`;
  const pid = parts[1];
  let result;

  switch (route) {
    case 'GET lists':
      result = { lists: [...d.lists].sort((a, b) => a.position - b.position) };
      break;
    case 'POST lists': {
      const title = clean(body.title);
      if (!title) fail(400, 'invalid', 'Give the list a name.');
      const l = { id: id(), title, position: Math.max(0, ...d.lists.map((x) => x.position)) + 1, visible: true, sortMode: 'manual', createdAt: now() };
      d.lists.push(l);
      result = { list: l };
      break;
    }
    case 'PATCH lists/:id': {
      const l = list(pid);
      if (body.title !== undefined && clean(body.title)) l.title = clean(body.title);
      if (body.visible !== undefined) l.visible = !!body.visible;
      if (['manual', 'date', 'priority', 'starred', 'title'].includes(body.sortMode)) l.sortMode = body.sortMode;
      result = { list: l };
      break;
    }
    case 'DELETE lists/:id': {
      list(pid);
      if (d.lists.length <= 1) fail(409, 'last_list', 'You need at least one list.');
      d.lists = d.lists.filter((l) => l.id !== pid);
      d.tasks = d.tasks.filter((t) => t.listId !== pid);
      result = { ok: true };
      break;
    }
    case 'DELETE lists/:id/completed': {
      list(pid);
      const gone = new Set(d.tasks.filter((t) => t.listId === pid && t.completedAt).map((t) => t.id));
      d.tasks = d.tasks.filter((t) => !gone.has(t.id) && !gone.has(t.parentId));
      result = { ok: true };
      break;
    }
    case 'GET tasks':
      result = { tasks: d.tasks };
      break;
    case 'POST tasks': {
      const l = list(body.listId);
      let parentId = null;
      if (body.parentId) {
        const p = task(body.parentId);
        if (p.parentId || p.listId !== l.id) fail(400, 'invalid', 'Subtasks can only be added to a task in the same list.');
        parentId = p.id;
      }
      const sibs = d.tasks.filter((t) => t.listId === l.id && (t.parentId || null) === parentId).map((t) => t.position);
      const position = body.placement === 'bottom' ? Math.max(0, ...sibs) + 1 : Math.min(1, ...sibs) - 1;
      let dueDate = typeof body.dueDate === 'string' && DATE.test(body.dueDate) ? body.dueDate : null;
      let rule = parentId ? null : cleanRule(body.repeat);
      if (rule) {
        dueDate = alignStart(rule, dueDate || todayKey());
        rule = anchorRule(rule, dueDate);
      }
      const t = {
        id: id(),
        listId: l.id,
        parentId,
        title: clean(body.title, 1000),
        notes: typeof body.notes === 'string' ? body.notes.slice(0, 20000) : '',
        dueDate,
        dueTime: dueDate && TIME.test(body.dueTime || '') ? body.dueTime : null,
        starredAt: body.starred ? now() : null,
        completedAt: null,
        position,
        priority: PRIORITIES.includes(body.priority) ? body.priority : null,
        seriesId: null,
        repeat: rule,
        repeatDone: 0,
        nextId: null,
        createdAt: now(),
        updatedAt: now()
      };
      d.tasks.push(t);
      result = { task: t };
      break;
    }
    case 'PATCH tasks/:id': {
      const t = task(pid);
      const stamp = now();
      if (body.title !== undefined) t.title = clean(body.title, 1000);
      if (body.notes !== undefined) t.notes = typeof body.notes === 'string' ? body.notes.slice(0, 20000) : '';
      if (body.dueDate !== undefined) {
        t.dueDate = typeof body.dueDate === 'string' && DATE.test(body.dueDate) ? body.dueDate : null;
        if (!t.dueDate) t.dueTime = null;
      }
      if (body.dueTime !== undefined) t.dueTime = t.dueDate && TIME.test(body.dueTime || '') ? body.dueTime : null;
      if (body.starred !== undefined) t.starredAt = body.starred ? t.starredAt || stamp : null;
      if (body.priority !== undefined) t.priority = PRIORITIES.includes(body.priority) ? body.priority : null;

      let rule = cleanRule(t.repeat);
      if (body.repeat !== undefined) rule = t.parentId ? null : cleanRule(body.repeat);
      else if (body.dueDate !== undefined && !t.dueDate) rule = null;
      if (rule) {
        if (!t.dueDate) t.dueDate = todayKey();
        if (body.repeat !== undefined) t.dueDate = alignStart(rule, t.dueDate);
        rule = anchorRule(rule, t.dueDate);
      }
      t.repeat = rule;

      const created = [];
      let removedId = null;
      if (body.completed !== undefined) {
        const completing = body.completed && !t.completedAt;
        const reopening = !body.completed && !!t.completedAt;
        t.completedAt = body.completed ? t.completedAt || stamp : null;
        if (completing && rule && t.dueDate) {
          const due = nextOccurrence(rule, t.dueDate, t.repeatDone || 0);
          if (due) {
            const nt = { ...clone(t), id: id(), dueDate: due, completedAt: null, repeatDone: (t.repeatDone || 0) + 1, nextId: null, seriesId: t.seriesId || t.id, createdAt: stamp, updatedAt: stamp };
            created.push(nt);
            for (const s of d.tasks.filter((x) => x.parentId === t.id)) {
              created.push({ ...clone(s), id: id(), parentId: nt.id, dueDate: null, dueTime: null, starredAt: null, completedAt: null, createdAt: stamp, updatedAt: stamp });
            }
            d.tasks.push(...created);
            t.nextId = nt.id;
          }
        }
        if (reopening && t.nextId) {
          const spawned = d.tasks.find((x) => x.id === t.nextId);
          if (spawned && !spawned.completedAt && spawned.createdAt === spawned.updatedAt) {
            d.tasks = d.tasks.filter((x) => x.id !== spawned.id && x.parentId !== spawned.id);
            removedId = spawned.id;
          }
          t.nextId = null;
        }
        if (body.completed && !t.parentId) for (const s of d.tasks) if (s.parentId === t.id && !s.completedAt) s.completedAt = stamp;
        if (!body.completed && t.parentId) {
          const p = d.tasks.find((x) => x.id === t.parentId);
          if (p) p.completedAt = null;
        }
      }
      t.updatedAt = stamp;
      result = { task: t, created, removedId };
      break;
    }
    case 'DELETE tasks/:id':
      task(pid);
      d.tasks = d.tasks.filter((t) => t.id !== pid && t.parentId !== pid);
      result = { ok: true };
      break;
    case 'POST tasks/restore': {
      const restored = [];
      const incoming = Array.isArray(body.tasks) ? [...body.tasks].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0)) : [];
      for (const r of incoming) {
        if (!r?.id || d.tasks.some((t) => t.id === r.id) || !d.lists.some((l) => l.id === r.listId)) continue;
        if (r.parentId && !d.tasks.some((t) => t.id === r.parentId)) continue;
        const t = { ...r, updatedAt: now() };
        d.tasks.push(t);
        restored.push(t);
      }
      result = { tasks: restored };
      break;
    }
    case 'POST tasks/:id/move': {
      const t = task(pid);
      const l = list(body.listId);
      let parentId = null;
      if (body.parentId) {
        const p = task(body.parentId);
        if (p.parentId || p.id === t.id || p.listId !== l.id || d.tasks.some((s) => s.parentId === t.id)) fail(400, 'invalid', 'Can’t move the task there.');
        parentId = p.id;
      }
      t.listId = l.id;
      t.parentId = parentId;
      t.updatedAt = now();
      for (const s of d.tasks) if (s.parentId === t.id) s.listId = l.id;
      (Array.isArray(body.order) ? body.order : []).forEach((oid, i) => {
        const s = d.tasks.find((x) => x.id === oid && x.listId === l.id && (x.parentId || null) === parentId);
        if (s) s.position = i + 1;
      });
      result = { task: t };
      break;
    }
    case 'GET calendar-links':
      result = { links: [] };
      break;
    case 'POST calendar-links':
      fail(409, 'preview', 'Calendar links need the app running on your own server.');
      break;
    case 'POST auth/logout':
      result = { ok: true, redirect: null };
      break;
    default:
      fail(404, 'not_found', 'Not available in the preview.');
  }

  save();
  return clone(result);
}
