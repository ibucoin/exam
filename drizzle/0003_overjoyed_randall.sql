CREATE TABLE `round_answers` (
	`round_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`attempt_id` integer,
	`answer_json` text NOT NULL,
	`is_correct` integer,
	`answered_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`round_id`, `question_id`),
	FOREIGN KEY (`round_id`) REFERENCES `study_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `round_answers_attempt_idx` ON `round_answers` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `study_rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`scope` text NOT NULL,
	`round_no` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_rounds_user_scope_no_unique` ON `study_rounds` (`user_id`,`scope`,`round_no`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fsrs_review_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`round_item_id` integer,
	`attempt_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`state` integer NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`last_elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_item_id`) REFERENCES `validation_round_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fsrs_review_logs`("id", "user_id", "question_id", "round_item_id", "attempt_id", "rating", "state", "due", "stability", "difficulty", "elapsed_days", "last_elapsed_days", "scheduled_days", "learning_steps", "reviewed_at") SELECT "id", "user_id", "question_id", "round_item_id", "attempt_id", "rating", "state", "due", "stability", "difficulty", "elapsed_days", "last_elapsed_days", "scheduled_days", "learning_steps", "reviewed_at" FROM `fsrs_review_logs`;--> statement-breakpoint
DROP TABLE `fsrs_review_logs`;--> statement-breakpoint
ALTER TABLE `__new_fsrs_review_logs` RENAME TO `fsrs_review_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `fsrs_review_logs_user_question_idx` ON `fsrs_review_logs` (`user_id`,`question_id`);