/**
 * Drag-and-drop of Tasks in the List columns (Custom Order), with Pointer Events so mouse, pen
 * and touch work alike, plus the keyboard alternative on a focused drag handle. Created by the
 * List page and shared with the rows through context ({@link setTaskDrag} / {@link getTaskDrag}).
 *
 * The page marks up what a drop needs to read from the screen:
 * - `[data-column="<listId>"]` around each List column,
 * - `[data-open-tasks]` on a column's list of open Tasks, `[data-subtasks-of="<parentId>"]` on
 *   the list of a parent's open Subtasks, and `li[data-task-id]` on each row,
 * - `[data-drop-empty]` on the placeholder of a column without open Tasks.
 *
 * The rules come from `#lib/domain/moves` (through the `TaskStore`) and `dropMove`.
 */
import { getContext, setContext, tick } from 'svelte';
import type { MoveProblem, TaskMove, Step } from '#lib/domain/moves.js';
import { m } from '#lib/paraglide/messages.js';
import type { SerializedTask } from '#lib/domain/tasks.js';
import type { ListStore } from './lists.svelte.js';
import { dropIndex, dropMove, type Depth, type Row } from './reorder.js';
import type { TaskStore } from './tasks.svelte.js';

/** How far the pointer must move before a press on the handle becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
/** How close to an edge of the scroll area auto-scrolling starts, and its top speed per frame. */
const EDGE_PX = 56;
const MAX_SCROLL_PX = 18;

/** A drag in progress, as the page shows it. */
export interface ActiveDrag {
	id: string;
	title: string;
	/** The pointer (viewport coordinates); a label with the Title follows it. */
	x: number;
	y: number;
	/** The drop indicator line (viewport coordinates), or `null` while there's no drop target. */
	indicator: { top: number; left: number; width: number } | null;
	/** Why dropping here isn't allowed, or `null` if it is. */
	invalid: string | null;
}

interface Target {
	listId: string;
	move: TaskMove;
	depth: Depth;
}

interface Press {
	id: string;
	pointerId: number;
	startX: number;
	startY: number;
	/** Where in the row the pointer grabbed it. */
	grabX: number;
	started: boolean;
}

const KEY_STEPS: Record<string, Step> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowRight: 'indent',
	ArrowLeft: 'outdent'
};

export class TaskDrag {
	readonly #tasks: TaskStore;
	readonly #lists: ListStore;
	readonly #scroller: () => HTMLElement | null;

	/** The drag in progress, or `null`. */
	active = $state<ActiveDrag | null>(null);
	/** Polite announcement of the last move, for screen readers. */
	announcement = $state('');

	#press: Press | null = null;
	#target: Target | null = null;
	#pointer = { x: 0, y: 0 };
	#frame = 0;

	/** `scroller` is the element that scrolls the columns sideways. */
	constructor(tasks: TaskStore, lists: ListStore, scroller: () => HTMLElement | null) {
		this.#tasks = tasks;
		this.#lists = lists;
		this.#scroller = scroller;
	}

	/** The id of the Task being dragged, if any. */
	get draggingId(): string | null {
		return this.active?.id ?? null;
	}

	/** Whether a Task can be dragged: it's open and its List is in Custom Order. */
	canDrag(task: SerializedTask): boolean {
		return !task.completedAt && this.#lists.get(task.listId)?.sortMode === 'custom';
	}

	// --- Pointer -----------------------------------------------------------------------------

	/** `pointerdown` on a row's drag handle. */
	start = (event: PointerEvent, task: SerializedTask): void => {
		if (this.#press || !this.canDrag(task)) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const row = (event.currentTarget as HTMLElement).closest('li[data-task-id]');
		if (!row) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).focus({ preventScroll: true });
		const rect = row.getBoundingClientRect();
		this.#press = {
			id: task.id,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			grabX: event.clientX - rect.left,
			started: false
		};
		window.addEventListener('pointermove', this.#onMove);
		window.addEventListener('pointerup', this.#onUp);
		window.addEventListener('pointercancel', this.#onCancel);
		window.addEventListener('keydown', this.#onKeydown, true);
	};

	#onMove = (event: PointerEvent): void => {
		const press = this.#press;
		if (!press || event.pointerId !== press.pointerId) return;
		this.#pointer = { x: event.clientX, y: event.clientY };
		if (!press.started) {
			const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
			if (distance < DRAG_THRESHOLD_PX) return;
			press.started = true;
			document.documentElement.classList.add('task-dragging');
			this.#frame = requestAnimationFrame(this.#autoScroll);
		}
		event.preventDefault();
		this.#update();
	};

	#onUp = (event: PointerEvent): void => {
		if (!this.#press || event.pointerId !== this.#press.pointerId) return;
		const { id, started } = this.#press;
		const target = this.#target;
		const invalid = this.active?.invalid ?? null;
		const title = this.active?.title ?? '';
		this.#end();
		if (!started) return;
		if (!target) return;
		if (invalid) {
			this.announcement = m.task_drag_cannot_move_there({ title, reason: invalid });
			return;
		}
		void this.#move(id, target.move, title);
	};

	#onCancel = (event: PointerEvent): void => {
		if (this.#press && event.pointerId === this.#press.pointerId) this.#end();
	};

	#onKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || !this.#press) return;
		// Esc cancels the drag, and nothing else (e.g. the detail panel stays open).
		event.preventDefault();
		event.stopPropagation();
		const started = this.#press.started;
		this.#end();
		if (started) this.announcement = m.task_drag_cancelled();
	};

	#end(): void {
		this.#press = null;
		this.#target = null;
		this.active = null;
		cancelAnimationFrame(this.#frame);
		document.documentElement.classList.remove('task-dragging');
		window.removeEventListener('pointermove', this.#onMove);
		window.removeEventListener('pointerup', this.#onUp);
		window.removeEventListener('pointercancel', this.#onCancel);
		window.removeEventListener('keydown', this.#onKeydown, true);
	}

	/** Works out the drop target under the pointer and redraws the drag. */
	#update(): void {
		const press = this.#press;
		const task = press && this.#tasks.get(press.id);
		if (!press || !task) return this.#end();
		const { x, y } = this.#pointer;
		const base = {
			id: task.id,
			title: task.title,
			x,
			y
		};

		const column = this.#columnAt(x, y);
		const list = column && this.#lists.get(column.dataset.column);
		if (!column || !list) {
			this.#target = null;
			this.active = { ...base, indicator: null, invalid: null };
			return;
		}
		if (list.sortMode !== 'custom') {
			this.#target = { listId: list.id, move: { listId: list.id, parentId: null }, depth: 0 };
			this.active = { ...base, indicator: null, invalid: m.task_drag_reason_not_custom_order() };
			return;
		}

		const rows = this.#rowsOf(column, task.id);
		const slot = dropIndex(
			rows.map(({ rect }) => rect.top + rect.height / 2),
			y
		);
		const area = column.querySelector<HTMLElement>('[data-open-tasks]');
		const areaRect = (area ?? column).getBoundingClientRect();
		const indent = this.#indent(column);
		// The left edge of the dragged row decides its depth. Moving it three quarters of an indent
		// to the right nests a Task; as far to the left takes a Subtask out of its parent.
		const offset = x - press.grabX - areaRect.left;
		const threshold = task.parentId === null ? indent * 0.75 : indent * 0.25;
		const wanted: Depth = offset > threshold ? 1 : 0;
		const { depth, move } = dropMove(list.id, rows, slot, wanted);
		const problem = this.#tasks.moveProblem(task.id, move);
		this.#target = { listId: list.id, move, depth };

		let top: number;
		if (rows.length === 0) {
			const empty = column.querySelector<HTMLElement>('[data-drop-empty]');
			top = (empty ?? column).getBoundingClientRect().top;
		} else if (slot < rows.length) {
			top = rows[slot].rect.top;
		} else {
			top = rows[rows.length - 1].rect.bottom;
		}
		const left = areaRect.left + depth * indent;
		this.active = {
			...base,
			indicator: { top, left, width: areaRect.right - left },
			invalid: problem && moveProblemText(problem)
		};
	}

	/** The List column under (or, between columns, nearest to) the pointer. */
	#columnAt(x: number, y: number): (HTMLElement & { dataset: { column: string } }) | null {
		const scroller = this.#scroller();
		if (scroller) {
			const bounds = scroller.getBoundingClientRect();
			if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
		}
		const columns = [...document.querySelectorAll<HTMLElement>('[data-column]')].filter(
			(el) => el.getClientRects().length > 0
		);
		let best: HTMLElement | null = null;
		let bestDistance = Infinity;
		for (const el of columns) {
			const rect = el.getBoundingClientRect();
			const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
			if (distance < bestDistance) {
				best = el;
				bestDistance = distance;
			}
		}
		return best as (HTMLElement & { dataset: { column: string } }) | null;
	}

	/** The visible open rows of a column, without the dragged Task and its Subtasks. */
	#rowsOf(column: HTMLElement, draggedId: string): Array<Row & { rect: DOMRect }> {
		const rows: Array<Row & { rect: DOMRect }> = [];
		for (const li of column.querySelectorAll<HTMLElement>('[data-open-tasks] li[data-task-id]')) {
			const id = li.dataset.taskId as string;
			const parentId = li.closest<HTMLElement>('[data-subtasks-of]')?.dataset.subtasksOf ?? null;
			if (id === draggedId || parentId === draggedId) continue;
			if (li.getClientRects().length === 0) continue; // collapsed
			rows.push({ id, parentId, rect: li.getBoundingClientRect() });
		}
		return rows;
	}

	/** How far Subtasks are indented in a column. */
	#indent(column: HTMLElement): number {
		const subtasks = column.querySelector<HTMLElement>('[data-subtasks-of]');
		const padding = subtasks && parseFloat(getComputedStyle(subtasks).paddingLeft);
		return padding || 32;
	}

	/** Scrolls the columns (sideways) and the page (up and down) while the pointer nears an edge. */
	#autoScroll = (): void => {
		if (!this.#press?.started) return;
		const { x, y } = this.#pointer;
		const speed = (distance: number) =>
			distance < EDGE_PX ? Math.ceil(MAX_SCROLL_PX * (1 - Math.max(0, distance) / EDGE_PX)) : 0;
		let scrolled = false;

		const scroller = this.#scroller();
		if (scroller && scroller.scrollWidth > scroller.clientWidth) {
			const rect = scroller.getBoundingClientRect();
			const dx = speed(rect.right - x) - speed(x - rect.left);
			if (dx !== 0) {
				const before = scroller.scrollLeft;
				scroller.scrollLeft += dx;
				scrolled ||= scroller.scrollLeft !== before;
			}
		}
		const header = document.querySelector('body > div header, header')?.getBoundingClientRect();
		const topEdge = header ? header.bottom : 0;
		const dy = speed(window.innerHeight - y) - speed(y - topEdge);
		if (dy !== 0) {
			const before = window.scrollY;
			window.scrollBy(0, dy);
			scrolled ||= window.scrollY !== before;
		}

		if (scrolled) this.#update();
		this.#frame = requestAnimationFrame(this.#autoScroll);
	};

	// --- Keyboard ----------------------------------------------------------------------------

	/**
	 * `keydown` on a row's drag handle: Arrow Up/Down move the Task among its siblings, Arrow
	 * Right makes it a Subtask of the Task above, Arrow Left takes it out of its parent.
	 */
	keydown = (event: KeyboardEvent, task: SerializedTask): void => {
		const step = KEY_STEPS[event.key];
		if (!step || event.altKey || event.ctrlKey || event.metaKey || !this.canDrag(task)) return;
		event.preventDefault();
		const move = this.#tasks.stepMove(task.id, step);
		if (!move) {
			this.announcement = nowhere(task, step);
			return;
		}
		const problem = this.#tasks.moveProblem(task.id, move);
		if (problem) {
			this.announcement = m.task_drag_cannot_move({
				title: task.title,
				reason: moveProblemText(problem)
			});
			return;
		}
		void this.#move(task.id, move, task.title, true);
	};

	/** Makes a move, announces it, and (after a keyboard move) puts focus back on the handle. */
	async #move(id: string, move: TaskMove, title: string, refocus = false): Promise<void> {
		const done = this.#tasks.move(id, move);
		this.announcement = this.#describe(id, title);
		if (refocus) {
			await tick();
			document
				.querySelector<HTMLElement>(`li[data-task-id="${id}"] [data-task-handle]`)
				?.focus({ preventScroll: false });
		}
		await done;
	}

	/** Where a Task is now, in words. */
	#describe(id: string, title: string): string {
		const task = this.#tasks.get(id);
		if (!task) return m.task_drag_moved({ title });
		const listName = this.#lists.get(task.listId)?.name ?? m.task_drag_list_fallback();
		if (task.parentId) {
			const parent = this.#tasks.get(task.parentId);
			const siblings = this.#tasks.subtasks(task.parentId).filter((t) => !t.completedAt);
			const index = siblings.findIndex((t) => t.id === id);
			return m.task_drag_new_subtask({
				title,
				position: index + 1,
				count: siblings.length,
				parent: parent?.title ?? m.task_drag_parent_fallback()
			});
		}
		const siblings = this.#tasks.openTasks(task.listId);
		const index = siblings.findIndex((t) => t.id === id);
		return m.task_drag_moved_to_position({
			title,
			position: index + 1,
			count: siblings.length,
			list: listName
		});
	}
}

/** Why a move isn't allowed, worded to follow "Can’t move … there:". */
function moveProblemText(problem: MoveProblem): string {
	switch (problem) {
		case 'parent-is-subtask':
			return m.task_move_problem_parent_is_subtask();
		case 'own-subtask':
			return m.task_move_problem_own_subtask();
		case 'has-subtasks':
			return m.task_move_problem_has_subtasks();
		case 'parent-completed':
			return m.task_move_problem_parent_completed();
		case 'parent-repeats':
			return m.task_move_problem_parent_repeats();
		case 'subtask-repeats':
			return m.task_move_problem_subtask_repeats();
		case 'unknown-task':
			return m.task_move_problem_unknown_task();
		case 'completed':
			return m.task_move_problem_completed();
		case 'unknown-parent':
			return m.task_move_problem_unknown_parent();
		case 'parent-in-other-list':
			return m.task_move_problem_parent_in_other_list();
		case 'before-and-after':
			return m.task_move_problem_before_and_after();
		case 'next-to-itself':
			return m.task_move_problem_next_to_itself();
		case 'unknown-neighbour':
			return m.task_move_problem_unknown_neighbour();
	}
}

function nowhere(task: SerializedTask, step: Step): string {
	const title = task.title;
	switch (step) {
		case 'up':
			return m.task_drag_already_top({ title });
		case 'down':
			return m.task_drag_already_bottom({ title });
		case 'indent':
			return task.parentId
				? m.task_drag_already_subtask({ title })
				: m.task_drag_no_parent_above({ title });
		case 'outdent':
			return m.task_drag_not_subtask({ title });
	}
}

const KEY = Symbol('task-drag');

export function setTaskDrag(drag: TaskDrag): TaskDrag {
	return setContext(KEY, drag);
}

/** The page's drag-and-drop, or `undefined` outside a List page. */
export function getTaskDrag(): TaskDrag | undefined {
	return getContext<TaskDrag | undefined>(KEY);
}
