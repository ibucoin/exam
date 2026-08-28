CREATE TABLE `question_notes` (
	`user_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
