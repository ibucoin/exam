CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`answer_json` text NOT NULL,
	`is_correct` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`assessed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_user_question_idx` ON `attempts` (`user_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `question_states` (
	`user_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`first_attempt_correct` integer NOT NULL,
	`last_attempt_correct` integer NOT NULL,
	`mastered` integer NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`last_answer_json` text NOT NULL,
	`last_answered_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_progress` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`last_skill_group` integer DEFAULT 1 NOT NULL,
	`last_skill_question_id` integer,
	`last_prescription_question_id` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`is_disabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);