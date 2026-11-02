CREATE TABLE `calendar_link_lists` (
	`calendar_link_id` text NOT NULL,
	`list_id` text NOT NULL,
	PRIMARY KEY(`calendar_link_id`, `list_id`),
	FOREIGN KEY (`calendar_link_id`) REFERENCES `calendar_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_link_lists_list_id_idx` ON `calendar_link_lists` (`list_id`);--> statement-breakpoint
CREATE TABLE `calendar_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`all_lists` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_accessed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_links_token_unique` ON `calendar_links` (`token`);--> statement-breakpoint
CREATE INDEX `calendar_links_user_id_idx` ON `calendar_links` (`user_id`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`sort_mode` text DEFAULT 'custom' NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lists_sort_mode_check" CHECK("sort_mode" in ('custom', 'planned', 'due', 'priority', 'title'))
);
--> statement-breakpoint
CREATE INDEX `lists_user_id_position_idx` ON `lists` (`user_id`,`position`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` text NOT NULL,
	`planned_date` text,
	`planned_date_time` text,
	`planned_time_zone` text,
	`planned_duration_minutes` integer,
	`due_date` text,
	`due_date_time` text,
	`due_time_zone` text,
	`priority` text,
	`completed_at` integer,
	`completed_by_cascade` integer DEFAULT false NOT NULL,
	`recurrence` text,
	`series_id` text,
	`occurrences_so_far` integer DEFAULT 1 NOT NULL,
	`generated_from_task_id` text,
	`changed_since_generated` integer DEFAULT false NOT NULL,
	`series_template` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generated_from_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_priority_check" CHECK("priority" in ('high', 'medium', 'low')),
	CONSTRAINT "tasks_planned_shape_check" CHECK(("planned_date" is null or "planned_date_time" is null) and ("planned_date_time" is null) = ("planned_time_zone" is null) and ("planned_date_time" is null) = ("planned_duration_minutes" is null)),
	CONSTRAINT "tasks_due_shape_check" CHECK(("due_date" is null or "due_date_time" is null) and ("due_date_time" is null) = ("due_time_zone" is null)),
	CONSTRAINT "tasks_not_own_parent_check" CHECK("parent_id" is null or "parent_id" <> "id")
);
--> statement-breakpoint
CREATE INDEX `tasks_user_list_parent_position_idx` ON `tasks` (`user_id`,`list_id`,`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_list_id_idx` ON `tasks` (`list_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_id_idx` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `tasks_series_id_idx` ON `tasks` (`series_id`);--> statement-breakpoint
CREATE INDEX `tasks_generated_from_task_id_idx` ON `tasks` (`generated_from_task_id`);--> statement-breakpoint
CREATE INDEX `tasks_user_open_priority_idx` ON `tasks` (`user_id`,`priority`) WHERE "completed_at" is null and "priority" is not null;--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_viewed_list_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_viewed_list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE set null
);
