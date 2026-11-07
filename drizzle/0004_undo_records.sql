CREATE TABLE `undo_records` (
	`user_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
