import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
	dateOnly,
	serializeDueDate,
	serializePlannedDate,
	timedDueDate,
	timedPlannedDate,
	unsetDate,
	type DueDate,
	type PlannedDate
} from '#lib/domain/dates.js';
import { parseRecurrence, type RecurrenceRule } from '#lib/domain/recurrence.js';
import { parseTask, serializeTask, type Task } from '#lib/domain/tasks.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';
import { taskColumns, toTask } from './mapping';
import { lists, tasks } from './schema';

function setUp() {
	const db = createTestDb();
	const user = insertUser(db, 'alice');
	const list = db
		.insert(lists)
		.values({ userId: user.id, name: 'List', position: 'a0' })
		.returning()
		.get();
	return { db, user, list };
}

const baseTask: Omit<Task, 'id' | 'listId' | 'createdAt' | 'updatedAt'> = {
	parentId: null,
	title: 'Title',
	description: 'Line 1\nLine 2',
	position: 'a0',
	planned: unsetDate,
	due: unsetDate,
	priority: null,
	completedAt: null,
	completedByCascade: false,
	recurrence: null,
	seriesId: null,
	occurrencesSoFar: 1,
	generatedFromTaskId: null,
	changedSinceGenerated: false,
	seriesTemplate: null
};

const plannedShapes: PlannedDate[] = [
	unsetDate,
	dateOnly('2026-11-04'),
	timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin'),
	timedPlannedDate('2026-03-29T02:30', 'Europe/Berlin', 90)
];
const dueShapes: DueDate[] = [
	unsetDate,
	dateOnly('2026-02-28'),
	timedDueDate('2026-11-04T17:45', 'America/New_York')
];

describe('task row mapping', () => {
	it.each(plannedShapes.flatMap((planned) => dueShapes.map((due) => ({ planned, due }))))(
		'round-trips Planned $planned.kind / Due $due.kind through the database',
		({ planned, due }) => {
			const { db, user, list } = setUp();

			const row = db
				.insert(tasks)
				.values({ userId: user.id, listId: list.id, ...taskColumns({ ...baseTask, planned, due }) })
				.returning()
				.get();
			const task = toTask(db.select().from(tasks).where(eq(tasks.id, row.id)).get()!);

			expect(serializePlannedDate(task.planned)).toEqual(serializePlannedDate(planned));
			expect(serializeDueDate(task.due)).toEqual(serializeDueDate(due));
		}
	);

	it('round-trips every other field, including Recurrence and JSON template', () => {
		const { db, user, list } = setUp();
		const parent = db
			.insert(tasks)
			.values({ userId: user.id, listId: list.id, ...taskColumns(baseTask) })
			.returning()
			.get();
		const recurrence: RecurrenceRule = parseRecurrence({
			frequency: 'weekly',
			interval: 2,
			weekdays: [1, 3],
			end: { kind: 'until', date: '2027-01-31' },
			anchor: 'schedule'
		});
		const fields = {
			...baseTask,
			parentId: parent.id,
			title: 'Sub',
			planned: dateOnly('2026-11-04'),
			priority: 'high' as const,
			completedAt: new Date('2026-11-02T10:11:12.345Z'),
			completedByCascade: true,
			recurrence,
			seriesId: 'series-1',
			occurrencesSoFar: 3,
			generatedFromTaskId: parent.id,
			changedSinceGenerated: true,
			seriesTemplate: {
				title: 'Template',
				description: '',
				priority: null,
				planned: dateOnly('2026-11-03'),
				due: unsetDate,
				subtasks: []
			}
		};

		const row = db
			.insert(tasks)
			.values({ userId: user.id, listId: list.id, ...taskColumns(fields) })
			.returning()
			.get();
		const task = toTask(row);

		expect(serializeTask(task)).toMatchObject({
			...serializeTask({
				...fields,
				id: row.id,
				listId: list.id,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt
			})
		});
		expect(task.completedAt).toEqual(fields.completedAt);
		expect(task.recurrence).toEqual(recurrence);
		expect(task.seriesTemplate).toEqual(fields.seriesTemplate);
	});

	it('round-trips through JSON (serializeTask / parseTask)', () => {
		const { db, user, list } = setUp();
		const row = db
			.insert(tasks)
			.values({
				userId: user.id,
				listId: list.id,
				...taskColumns({
					...baseTask,
					planned: timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin', 45),
					due: dateOnly('2026-11-05'),
					completedAt: new Date('2026-11-02T10:00:00.000Z')
				})
			})
			.returning()
			.get();
		const task = toTask(row);

		const json = JSON.parse(JSON.stringify(serializeTask(task)));

		expect(serializeTask(parseTask(json))).toEqual(serializeTask(task));
	});

	it('rejects rows whose dates break the CHECK constraints', () => {
		const { db, user, list } = setUp();

		expect(() =>
			db
				.insert(tasks)
				.values({
					userId: user.id,
					listId: list.id,
					title: 'Bad',
					position: 'a0',
					plannedDateTime: '2026-11-04T09:00'
				})
				.run()
		).toThrow(/CHECK constraint/);
		expect(() =>
			db
				.insert(tasks)
				.values({
					userId: user.id,
					listId: list.id,
					title: 'Bad',
					position: 'a0',
					dueDate: '2026-11-04',
					dueDateTime: '2026-11-04T09:00',
					dueTimeZone: 'UTC'
				})
				.run()
		).toThrow(/CHECK constraint/);
	});
});
