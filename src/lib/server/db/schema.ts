import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import type { SortMode } from '#lib/domain/lists.js';
import type { SerializedRecurrence } from '#lib/domain/recurrence.js';
import type { Priority, SerializedSeriesTemplate } from '#lib/domain/tasks.js';

/**
 * A person who signs in through the configured OIDC provider. Identified by
 * the provider's issuer and `sub` claim; `id` is our own random key so the
 * `sub` never leaks into URLs or other tables.
 */
export const users = sqliteTable(
	'users',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		issuer: text('issuer').notNull(),
		subject: text('subject').notNull(),
		/** Display name from the latest login's claims. */
		name: text('name').notNull(),
		/** Email from the latest login's claims, if the provider sent one. */
		email: text('email'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		lastLoginAt: integer('last_login_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [uniqueIndex('users_issuer_subject_unique').on(table.issuer, table.subject)]
);

export type User = typeof users.$inferSelect;

/**
 * A signed-in browser. `id` is the SHA-256 hash (hex) of the session token in
 * the cookie; the token itself is never stored.
 */
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [
		index('sessions_user_id_idx').on(table.userId),
		index('sessions_expires_at_idx').on(table.expiresAt)
	]
);

export type Session = typeof sessions.$inferSelect;

/** Millisecond timestamps for the app's own tables, so quick successive changes still order. */
const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs);
const updatedAt = () =>
	integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(nowMs)
		.$onUpdate(() => new Date());

/** A named, ordered collection of Tasks owned by one User (CONTEXT.md → List). */
export const lists = sqliteTable(
	'lists',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Fractional-index key (`fractional-indexing`); the User's List order. */
		position: text('position').notNull(),
		sortMode: text('sort_mode').$type<SortMode>().notNull().default('custom'),
		/** Whether the List's column is shown in the multi-List layout (#10). */
		visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('lists_user_id_position_idx').on(table.userId, table.position),
		check(
			'lists_sort_mode_check',
			sql.raw(`"sort_mode" in ('custom', 'planned', 'due', 'priority', 'title')`)
		)
	]
);

export type ListRow = typeof lists.$inferSelect;

/**
 * A Task or Subtask (CONTEXT.md → Task). Dates are stored in plain columns so they can be
 * queried and indexed; `#lib/server/db/mapping.ts` converts rows to domain values:
 *
 * - Planned Date: unset (all four `planned_*` null), date-only (`planned_date` = `YYYY-MM-DD`), or
 *   timed (`planned_date_time` = wall-clock `YYYY-MM-DDTHH:mm`, `planned_time_zone` = IANA zone,
 *   `planned_duration_minutes`).
 * - Due Date: the same, without a Duration.
 *
 * The CHECK constraints keep each date in exactly one of those shapes.
 */
export const tasks = sqliteTable(
	'tasks',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		listId: text('list_id')
			.notNull()
			.references(() => lists.id, { onDelete: 'cascade' }),
		/** Set for Subtasks. One level deep, enforced in code; a Subtask lives in its parent's List. */
		parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id, {
			onDelete: 'cascade'
		}),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		/** Fractional-index key within (list, parent): Custom Order. */
		position: text('position').notNull(),

		plannedDate: text('planned_date'),
		plannedDateTime: text('planned_date_time'),
		plannedTimeZone: text('planned_time_zone'),
		plannedDurationMinutes: integer('planned_duration_minutes'),
		dueDate: text('due_date'),
		dueDateTime: text('due_date_time'),
		dueTimeZone: text('due_time_zone'),

		priority: text('priority').$type<Priority>(),
		completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
		/** Completed by the parent's completion cascade (#7); Reopen restores only these. */
		completedByCascade: integer('completed_by_cascade', { mode: 'boolean' })
			.notNull()
			.default(false),

		/** `serializeRecurrence` output; null for non-recurring Tasks. */
		recurrence: text('recurrence', { mode: 'json' }).$type<SerializedRecurrence>(),
		/** Shared by all Occurrences of one Recurrence. */
		seriesId: text('series_id'),
		occurrencesSoFar: integer('occurrences_so_far').notNull().default(1),
		/** The Occurrence whose completion created this one (#16). */
		generatedFromTaskId: text('generated_from_task_id').references(
			(): AnySQLiteColumn => tasks.id,
			{ onDelete: 'set null' }
		),
		/** Changed by the User since it was generated; decides what Reopen does (#16). */
		changedSinceGenerated: integer('changed_since_generated', { mode: 'boolean' })
			.notNull()
			.default(false),
		/**
		 * `serializeSeriesTemplate` output: what future Occurrences are generated from after a "This
		 * Occurrence" edit (#17); null while the current Occurrence is itself the template.
		 */
		seriesTemplate: text('series_template', { mode: 'json' }).$type<SerializedSeriesTemplate>(),

		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('tasks_user_list_parent_position_idx').on(
			table.userId,
			table.listId,
			table.parentId,
			table.position
		),
		index('tasks_list_id_idx').on(table.listId),
		index('tasks_parent_id_idx').on(table.parentId),
		index('tasks_series_id_idx').on(table.seriesId),
		index('tasks_generated_from_task_id_idx').on(table.generatedFromTaskId),
		// Priority View (#13): open Tasks with a Priority across all Lists.
		index('tasks_user_open_priority_idx')
			.on(table.userId, table.priority)
			.where(sql.raw('"completed_at" is null and "priority" is not null')),
		// CHECKs name bare columns (not table.column) so they survive drizzle's table rebuilds.
		check('tasks_priority_check', sql.raw(`"priority" in ('high', 'medium', 'low')`)),
		check(
			'tasks_planned_shape_check',
			sql.raw(
				'("planned_date" is null or "planned_date_time" is null) and ' +
					'("planned_date_time" is null) = ("planned_time_zone" is null) and ' +
					'("planned_date_time" is null) = ("planned_duration_minutes" is null)'
			)
		),
		check(
			'tasks_due_shape_check',
			sql.raw(
				'("due_date" is null or "due_date_time" is null) and ' +
					'("due_date_time" is null) = ("due_time_zone" is null)'
			)
		),
		check('tasks_not_own_parent_check', sql.raw('"parent_id" is null or "parent_id" <> "id"'))
	]
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;

/**
 * The User's latest undoable action, so it can be undone (CONTEXT.md → Undo, ADR 0004). A newer
 * action replaces the row, so there is at most one per User. Only `#lib/server/undo.ts` reads the
 * JSON, and it has to survive changes to `tasks`, so it is plain text here.
 */
export const undoRecords = sqliteTable('undo_records', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** Given to the browser with the action's answer; Undo has to name it. */
	id: text('id').notNull(),
	/** JSON: every Task of the touched Task families as they were before the action. */
	before: text('before').notNull(),
	/** JSON: the same families as the action left them. */
	after: text('after').notNull()
});

/** Per-User settings. A row exists once the User has been set up (see `ensureUserSetUp`). */
export const userPreferences = sqliteTable('user_preferences', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	/**
	 * The User's chosen Language (CONTEXT.md → Language): `'automatic'` or a Language code such as
	 * `'de'`. Plain text so the schema doesn't depend on which Languages exist; read through
	 * `isLanguagePreference`, which treats anything unknown as Automatic.
	 */
	languagePreference: text('language_preference').notNull().default('automatic'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export type UserPreferencesRow = typeof userPreferences.$inferSelect;

/**
 * A secret URL publishing the dated Tasks of some Lists (CONTEXT.md → Calendar Link, ADR 0001).
 * The token is stored in plain text because its URL must stay retrievable (#18).
 */
export const calendarLinks = sqliteTable(
	'calendar_links',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		token: text('token').notNull(),
		/** Covers every List, including ones created later; otherwise `calendar_link_lists`. */
		allLists: integer('all_lists', { mode: 'boolean' }).notNull().default(true),
		createdAt: createdAt(),
		lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp_ms' })
	},
	(table) => [
		uniqueIndex('calendar_links_token_unique').on(table.token),
		index('calendar_links_user_id_idx').on(table.userId)
	]
);

export type CalendarLinkRow = typeof calendarLinks.$inferSelect;

/** The Lists a Calendar Link covers when it doesn't cover all of them. */
export const calendarLinkLists = sqliteTable(
	'calendar_link_lists',
	{
		calendarLinkId: text('calendar_link_id')
			.notNull()
			.references(() => calendarLinks.id, { onDelete: 'cascade' }),
		listId: text('list_id')
			.notNull()
			.references(() => lists.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.calendarLinkId, table.listId] }),
		index('calendar_link_lists_list_id_idx').on(table.listId)
	]
);
