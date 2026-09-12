CREATE TABLE `exam_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` integer NOT NULL,
	`position` integer NOT NULL,
	`question_id` integer NOT NULL,
	`kind` text NOT NULL,
	`options_json` text NOT NULL,
	`answer_json` text DEFAULT '[]' NOT NULL,
	`is_correct` integer,
	`corrected_at` integer,
	FOREIGN KEY (`paper_id`) REFERENCES `exam_papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_items_position_unique` ON `exam_items` (`paper_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_items_question_unique` ON `exam_items` (`paper_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `exam_items_paper_id_idx` ON `exam_items` (`paper_id`);--> statement-breakpoint
CREATE TABLE `exam_papers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_key` integer DEFAULT true,
	`started_at` integer NOT NULL,
	`deadline` integer NOT NULL,
	`submitted_at` integer,
	`score` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_papers_user_current_unique` ON `exam_papers` (`user_id`,`current_key`);