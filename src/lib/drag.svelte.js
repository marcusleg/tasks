/** Shared drag-and-drop state for reordering tasks (only in "My order" lists). */
import { moveTask, taskById, subtasks } from './store.svelte.js';

export const drag = $state({ id: null, overId: null, after: false, overList: null });

export function start(e, task) {
  drag.id = task.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', task.id);
}

export function end() {
  drag.id = null;
  drag.overId = null;
  drag.overList = null;
}

/** Can the dragged task land next to `target`? Tasks with subtasks can't become subtasks. */
function allowed(target) {
  const dragged = taskById(drag.id);
  if (!dragged || dragged.id === target.id) return false;
  if (target.parentId && subtasks(dragged.id, true).length) return false;
  if (target.parentId === dragged.id) return false;
  return true;
}

export function overRow(e, target) {
  if (!drag.id || !allowed(target)) return;
  e.preventDefault();
  const rect = e.currentTarget.getBoundingClientRect();
  drag.overId = target.id;
  drag.after = e.clientY > rect.top + rect.height / 2;
  drag.overList = null;
}

export function dropOnRow(e, target, siblings) {
  if (!drag.id || !allowed(target)) return;
  e.preventDefault();
  const id = drag.id;
  let beforeId = target.id;
  if (drag.after) {
    const i = siblings.findIndex((t) => t.id === target.id);
    const next = siblings.slice(i + 1).find((t) => t.id !== id);
    beforeId = next ? next.id : null;
  }
  end();
  moveTask(id, { listId: target.listId, parentId: target.parentId || null, beforeId });
}

export function overList(e, listId) {
  if (!drag.id) return;
  e.preventDefault();
  if (!drag.overId) drag.overList = listId;
}

export function dropOnList(e, listId) {
  if (!drag.id) return;
  e.preventDefault();
  const id = drag.id;
  end();
  moveTask(id, { listId, parentId: null, beforeId: null });
}
