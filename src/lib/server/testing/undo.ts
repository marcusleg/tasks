import { expect } from 'vitest';
import { serializeTask, type Task } from '#lib/domain/tasks.js';
import type { UserScope } from '../scope.js';
import { getTasksOfLists, type TaskChangeSet } from '../tasks.js';
import { undoable, undoLatest } from '../undo.js';

/** A Task with all of its fields but `updatedAt`, comparable by value. */
const comparable = (task: Task) => ({ ...serializeTask(task), updatedAt: undefined });

/** Every Task of the Lists, in Custom Order, comparable by value. */
export function wholeLists(scope: UserScope, ...listIds: string[]) {
	return getTasksOfLists(scope, listIds).map(comparable);
}

const sortedById = (tasks: ReturnType<typeof comparable>[]) =>
	[...tasks].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Does `action`, undoes it, and checks that the whole of these Lists is identical to before, apart
 * from `updatedAt`. Also checks that the action changed them, so it can't pass by doing nothing, and
 * that Undo's answer takes a browser from the action's state to that one. Returns the answer.
 */
export function expectUndoRestoresLists(
	scope: UserScope,
	listIds: string[],
	action: () => object | undefined
): TaskChangeSet {
	const before = wholeLists(scope, ...listIds);

	const done = undoable(scope, action);
	expect(done?.undoId, 'the action should be undoable').toEqual(expect.any(String));
	const acted = wholeLists(scope, ...listIds);
	expect(acted, 'the action should change the Lists').not.toEqual(before);

	const changes = undoLatest(scope, done!.undoId!);
	expect(changes, 'Undo should apply').toBeDefined();
	expect(wholeLists(scope, ...listIds)).toEqual(before);

	const inBrowser = new Map(acted.map((task) => [task.id, task]));
	for (const id of changes!.deleted) inBrowser.delete(id);
	for (const task of changes!.upserted) inBrowser.set(task.id, comparable(task));
	expect(
		sortedById([...inBrowser.values()]),
		'Undo’s answer should bring the browser along'
	).toEqual(sortedById(before));
	return changes!;
}
