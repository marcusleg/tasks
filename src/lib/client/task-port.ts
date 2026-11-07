/**
 * What a {@link TaskStore} needs from the outside: the server's task mutations and a reload of
 * the page data (ADR 0003). In production this is the JSON endpoints (`task-port.http.ts`); specs
 * use an in-process adapter that calls the same endpoints on in-memory SQLite.
 */
import type { TaskMove } from '#lib/domain/moves.js';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import type { TaskChanges } from '#lib/domain/tasks.js';
import type { TaskPatch } from './api.js';

export type { TaskPatch };

export interface NewTaskInput {
	id: string;
	listId: string;
	title: string;
	parentId?: string | null;
	/** For a Subtask of a recurring Task: This Occurrence only, or all future ones too. */
	applyTo?: ApplyTo;
}

export interface DeletedTaskChanges extends TaskChanges {
	/** For {@link TaskPort.undo}. */
	undo: string | null;
}

export interface TaskPort {
	createTask(input: NewTaskInput): Promise<TaskChanges>;
	updateTask(id: string, patch: TaskPatch, applyTo?: ApplyTo): Promise<TaskChanges>;
	/** `timeZone` is the browser's, for completion-anchored Recurrences. `undo`: see {@link undo}. */
	completeTask(id: string, timeZone: string): Promise<TaskChanges & { undo: string | null }>;
	reopenTask(id: string): Promise<TaskChanges>;
	deleteTask(
		id: string,
		options: { applyTo?: ApplyTo; timeZone?: string }
	): Promise<DeletedTaskChanges>;
	/** Puts back the state before the action whose answer carried this `undo` (ADR 0004). */
	undo(undoId: string): Promise<TaskChanges>;
	/** `undo` is for {@link TaskPort.undo}; it is `null` for a move within a List, which offers none. */
	moveTask(id: string, move: TaskMove): Promise<TaskChanges & { undo: string | null }>;
	deleteCompletedTasks(listId: string): Promise<TaskChanges>;
	/** Reloads the page data, so the store's copy matches the server again. */
	reload(): Promise<void>;
}
