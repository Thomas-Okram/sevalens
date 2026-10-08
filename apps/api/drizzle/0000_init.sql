CREATE TABLE `anomaly_reviews` (
	`anomaly_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`user_id` integer,
	`user_email` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY NOT NULL,
	`ref_no` text NOT NULL,
	`applicant_name` text NOT NULL,
	`scheme_id` integer NOT NULL,
	`district_id` integer NOT NULL,
	`block_id` integer NOT NULL,
	`submitted_at` text NOT NULL,
	`status` text NOT NULL,
	`decided_at` text,
	`officer_id` integer,
	`pending_stage` text,
	FOREIGN KEY (`scheme_id`) REFERENCES `schemes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`officer_id`) REFERENCES `officers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `app_block_status_idx` ON `applications` (`block_id`,`status`);--> statement-breakpoint
CREATE INDEX `app_district_idx` ON `applications` (`district_id`);--> statement-breakpoint
CREATE INDEX `app_officer_idx` ON `applications` (`officer_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`user_id` integer,
	`user_email` text,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`details` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `audit_ts_idx` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE TABLE `beneficiaries` (
	`id` integer PRIMARY KEY NOT NULL,
	`aadhaar_last4` text NOT NULL,
	`aadhaar_hash` text NOT NULL,
	`name` text NOT NULL,
	`gender` text NOT NULL,
	`dob` text NOT NULL,
	`district_id` integer NOT NULL,
	`block_id` integer NOT NULL,
	`village` text NOT NULL,
	`scheme_id` integer NOT NULL,
	`status` text NOT NULL,
	`enrolled_at` text NOT NULL,
	`deceased_at` text,
	FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scheme_id`) REFERENCES `schemes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ben_block_scheme_idx` ON `beneficiaries` (`block_id`,`scheme_id`,`status`);--> statement-breakpoint
CREATE INDEX `ben_district_idx` ON `beneficiaries` (`district_id`);--> statement-breakpoint
CREATE INDEX `ben_hash_idx` ON `beneficiaries` (`aadhaar_hash`);--> statement-breakpoint
CREATE INDEX `ben_block_dob_idx` ON `beneficiaries` (`block_id`,`dob`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` integer PRIMARY KEY NOT NULL,
	`district_id` integer NOT NULL,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`pop_share` real NOT NULL,
	`remoteness` real NOT NULL,
	FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `blocks_district_idx` ON `blocks` (`district_id`);--> statement-breakpoint
CREATE TABLE `disbursements` (
	`id` integer PRIMARY KEY NOT NULL,
	`beneficiary_id` integer NOT NULL,
	`scheme_id` integer NOT NULL,
	`district_id` integer NOT NULL,
	`block_id` integer NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`paid_at` text NOT NULL,
	FOREIGN KEY (`beneficiary_id`) REFERENCES `beneficiaries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dis_block_month_idx` ON `disbursements` (`block_id`,`month`,`status`);--> statement-breakpoint
CREATE INDEX `dis_ben_idx` ON `disbursements` (`beneficiary_id`);--> statement-breakpoint
CREATE TABLE `districts` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`hq_lat` real NOT NULL,
	`hq_lng` real NOT NULL,
	`population` integer NOT NULL,
	`pct_elderly` real NOT NULL,
	`pct_widows` real NOT NULL,
	`pct_pwd` real NOT NULL,
	`pct_rural` real NOT NULL,
	`remoteness` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `districts_code_unique` ON `districts` (`code`);--> statement-breakpoint
CREATE TABLE `insights_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`district_id` integer,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`model` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `officers` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`designation` text NOT NULL,
	`block_id` integer NOT NULL,
	`district_id` integer NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `officers_code_unique` ON `officers` (`code`);--> statement-breakpoint
CREATE TABLE `schemes` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`category` text NOT NULL,
	`min_age` integer,
	`max_age` integer,
	`gender` text,
	`requires_pwd` integer DEFAULT false NOT NULL,
	`requires_bpl` integer DEFAULT false NOT NULL,
	`eligibility_text` text NOT NULL,
	`eligible_basis` text NOT NULL,
	`eligible_factor` real NOT NULL,
	`benefit_amount` integer NOT NULL,
	`frequency` text NOT NULL,
	`sla_days` integer NOT NULL,
	`exclusive_group` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schemes_code_unique` ON `schemes` (`code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`district_id` integer,
	FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);