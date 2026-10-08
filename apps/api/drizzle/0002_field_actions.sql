CREATE TABLE `field_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`district_id` integer NOT NULL,
	`block_id` integer NOT NULL,
	`anomaly_id` text,
	`title` text NOT NULL,
	`assigned_to_user_id` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `actions_district_status_idx` ON `field_actions` (`district_id`,`status`);