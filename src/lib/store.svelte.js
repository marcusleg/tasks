/**
 * Client-side copy of the signed-in user's lists and tasks. Changes are applied here first
 * (so the page reacts immediately) and then sent to the server; on failure the data is reloaded.
 */
import { api } from './api.js';
import { todayKey } from './dates.js';

export const store = $state({
  lists: [],
  tasks: [],
  loaded: false,
  loadError: '',
  toasts: []
});

let toastId = 0;

export function toast(message, action) {
  const id = ++toastId;
  store.toasts.push({ id, message, action });
  setTimeout(() => dismissToast(id), action ? 6000 : 4000);
}

export function dismissToast(id) {
  store.toasts = store.toasts.filter((t) => t.id !== id);
}

export async function load() {
  try {
    const [l, t] = await Promise.all([api('GET', '/api/lists'), api('GET', '/api/tasks')]);
    store.lists = l.lists;
    store.tasks = t.tasks;
    store.loaded = true;
    store.loadError = '';
  } catch (err) {
    store.loadError = err.message;
    if (err.status === 401) window.location.reload();
  }
}

async function run(promise, failMessage) {
  try {
    return await promise;
  } catch (err) {
    toast(err.status === 0 ? err.message : failMessage || err.message);
    await load();
    return null;
  }
}

/* ---------- queries ---------- */

export function sortedLists() {
  return [...store.lists].sort((a, b) => a.position - b.position);
}

export function listById(id) {
  return store.lists.find((l) => l.id === id);
}

export function taskById(id) {
  return store.tasks.find((t) => t.id === id);
}

function compareManual(a, b) {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

function compareDate(a, b) {
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  const at = a.dueTime || '99:99';
  const bt = b.dueTime || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return compareManual(a, b);
}

function compareStarred(a, b) {
  if (a.starredAt && !b.starredAt) return -1;
  if (!a.starredAt && b.starredAt) return 1;
  if (a.starredAt && b.starredAt && a.starredAt !== b.starredAt) return a.starredAt > b.starredAt ? -1 : 1;
  return compareManual(a, b);
}

function compareTitle(a, b) {
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || compareManual(a, b);
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
function comparePriority(a, b) {
  return (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) || compareDate(a, b);
}

const comparers = { manual: compareManual, date: compareDate, priority: comparePriority, starred: compareStarred, title: compareTitle };

export function activeTasks(listId, sortMode = 'manual') {
  return store.tasks
    .filter((t) => t.listId === listId && !t.parentId && !t.completedAt)
    .sort(comparers[sortMode] || compareManual);
}

export function subtasks(parentId, includeCompleted = false) {
  return store.tasks
    .filter((t) => t.parentId === parentId && (includeCompleted || !t.completedAt))
    .sort(compareManual);
}

export function completedTasks(listId) {
  return store.tasks
    .filter((t) => t.listId === listId && t.completedAt && !(t.parentId && isCompleted(t.parentId)))
    .sort((a, b) => (a.completedAt > b.completedAt ? -1 : 1));
}

function isCompleted(id) {
  return !!taskById(id)?.completedAt;
}

export function starredTasks() {
  const visible = new Set(store.lists.map((l) => l.id));
  return store.tasks
    .filter((t) => t.starredAt && !t.completedAt && visible.has(t.listId))
    .sort((a, b) => (a.starredAt > b.starredAt ? -1 : 1));
}

export function openCount(listId) {
  return store.tasks.filter((t) => t.listId === listId && !t.completedAt && !t.parentId).length;
}

export function isOverdue(task) {
  return !!task.dueDate && !task.completedAt && task.dueDate < todayKey();
}

/* ---------- lists ---------- */

export async function createList(title) {
  const res = await run(api('POST', '/api/lists', { title }), 'Couldn’t create the list');
  if (res) store.lists.push(res.list);
  return res?.list;
}

export async function updateList(id, patch) {
  const list = listById(id);
  if (list) Object.assign(list, patch);
  await run(api('PATCH', `/api/lists/${id}`, patch), 'Couldn’t update the list');
}

export async function deleteList(id) {
  store.lists = store.lists.filter((l) => l.id !== id);
  store.tasks = store.tasks.filter((t) => t.listId !== id);
  await run(api('DELETE', `/api/lists/${id}`), 'Couldn’t delete the list');
}

export async function clearCompleted(listId) {
  const doomed = new Set(store.tasks.filter((t) => t.listId === listId && t.completedAt).map((t) => t.id));
  store.tasks = store.tasks.filter((t) => !doomed.has(t.id) && !doomed.has(t.parentId));
  await run(api('DELETE', `/api/lists/${listId}/completed`), 'Couldn’t delete completed tasks');
}

/* ---------- tasks ---------- */

export async function createTask(fields) {
  const res = await run(api('POST', '/api/tasks', fields), 'Couldn’t add the task');
  if (res) {
    store.tasks.push(res.task);
    if (res.positions) applyPositions(res.positions);
  }
  return res?.task;
}

export async function updateTask(id, patch) {
  const task = taskById(id);
  if (task) Object.assign(task, patch);
  const res = await run(api('PATCH', `/api/tasks/${id}`, patch), 'Couldn’t save the task');
  applyTaskResult(id, res);
  return res;
}

/** Copies server-computed fields back (without overwriting text being typed) and adds/removes repeat occurrences. */
function applyTaskResult(id, res) {
  if (!res?.task) return;
  const t = taskById(id);
  if (t) {
    for (const k of ['starredAt', 'completedAt', 'updatedAt', 'listId', 'parentId', 'dueDate', 'dueTime', 'priority', 'repeat', 'repeatDone', 'nextId']) {
      t[k] = res.task[k];
    }
  }
  if (res.created?.length) store.tasks.push(...res.created.filter((c) => !taskById(c.id)));
  if (res.removedId) store.tasks = store.tasks.filter((x) => x.id !== res.removedId && x.parentId !== res.removedId);
}

export async function setStarred(id, starred) {
  const task = taskById(id);
  if (task) task.starredAt = starred ? new Date().toISOString() : null;
  await updateTask(id, { starred });
}

export async function setCompleted(id, completed) {
  const now = new Date().toISOString();
  const task = taskById(id);
  if (!task) return;
  task.completedAt = completed ? now : null;
  if (completed && !task.parentId) {
    for (const s of store.tasks) if (s.parentId === id && !s.completedAt) s.completedAt = now;
  }
  if (!completed && task.parentId) {
    const parent = taskById(task.parentId);
    if (parent?.completedAt) parent.completedAt = null;
  }
  const res = await run(api('PATCH', `/api/tasks/${id}`, { completed }), 'Couldn’t update the task');
  applyTaskResult(id, res);
  if (completed) {
    const next = res?.created?.find((c) => !c.parentId);
    toast(next ? 'Task completed. The next one is ready.' : '1 task completed', { label: 'Undo', run: () => setCompleted(id, false) });
  }
}

export async function deleteTask(id) {
  const task = taskById(id);
  if (!task) return;
  const removed = store.tasks.filter((t) => t.id === id || t.parentId === id);
  store.tasks = store.tasks.filter((t) => t.id !== id && t.parentId !== id);
  const ok = await run(api('DELETE', `/api/tasks/${id}`), 'Couldn’t delete the task');
  if (ok) {
    toast('Task deleted', {
      label: 'Undo',
      run: async () => {
        const res = await run(api('POST', '/api/tasks/restore', { tasks: $state.snapshot(removed) }), 'Couldn’t restore the task');
        if (res) store.tasks.push(...res.tasks);
      }
    });
  }
}

function applyPositions(positions) {
  for (const [id, pos] of Object.entries(positions)) {
    const t = taskById(id);
    if (t) t.position = pos;
  }
}

/**
 * Move a task to a list (and optionally under a parent), placing it before `beforeId`
 * (or at the end when beforeId is null). Sends the full new order of its siblings.
 */
export async function moveTask(id, { listId, parentId = null, beforeId = null }) {
  const task = taskById(id);
  if (!task || id === beforeId) return;
  task.listId = listId;
  task.parentId = parentId;
  for (const s of store.tasks) if (s.parentId === id) s.listId = listId;
  const siblings = store.tasks
    .filter((t) => t.listId === listId && (t.parentId || null) === parentId && !t.completedAt && t.id !== id)
    .sort(compareManual);
  const idx = beforeId ? siblings.findIndex((t) => t.id === beforeId) : -1;
  siblings.splice(idx === -1 ? siblings.length : idx, 0, task);
  siblings.forEach((t, i) => (t.position = i + 1));
  await run(
    api('POST', `/api/tasks/${id}/move`, { listId, parentId, order: siblings.map((t) => t.id) }),
    'Couldn’t move the task'
  );
}
