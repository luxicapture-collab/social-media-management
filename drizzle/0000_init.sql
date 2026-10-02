CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"action" text,
	"importance" text NOT NULL,
	"url" text,
	"read" boolean DEFAULT false NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"content_id" text,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"storage_key" text NOT NULL,
	"url" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer,
	"width" integer,
	"height" integer,
	"duration_sec" double precision,
	"source" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"languages" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"website" text,
	"industry" text,
	"brief" jsonb NOT NULL,
	"autonomy" jsonb NOT NULL,
	"agent_read" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text,
	"handle" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mode" text DEFAULT 'live' NOT NULL,
	"route" text DEFAULT 'direct' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"scenario_id" text,
	"title" text NOT NULL,
	"angle" text,
	"format" text NOT NULL,
	"platforms" jsonb NOT NULL,
	"status" text DEFAULT 'concept' NOT NULL,
	"revision_of" text,
	"revision_note" text,
	"hook" text DEFAULT '' NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"captions" jsonb NOT NULL,
	"story_frames" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_comments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"production" jsonb,
	"quote" jsonb,
	"actual_cost_usd" double precision DEFAULT 0 NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"trial_reel" boolean DEFAULT false NOT NULL,
	"experiment_id" text,
	"critique" jsonb,
	"scheduled_at" timestamp with time zone,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"performance" jsonb,
	"agent_note" text,
	"concept" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"goal_id" text,
	"kind" text DEFAULT 'major' NOT NULL,
	"bottleneck" text,
	"lever" text NOT NULL,
	"finding" text NOT NULL,
	"change" text NOT NULL,
	"expected" text NOT NULL,
	"metric" text NOT NULL,
	"baseline_value" double precision,
	"result_value" double precision,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_on" timestamp with time zone NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"content_id" text NOT NULL,
	"client_id" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"input" jsonb NOT NULL,
	"depends_on" text,
	"external_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"asset_id" text,
	"est_cost_usd" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"statement" text NOT NULL,
	"kpi" text NOT NULL,
	"platform" text,
	"target" double precision NOT NULL,
	"baseline" double precision,
	"current" double precision,
	"start_date" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"pace" text DEFAULT 'unknown' NOT NULL,
	"behind_streak" integer DEFAULT 0 NOT NULL,
	"agent_read" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"thread_id" text,
	"parent_external_id" text,
	"post_external_id" text,
	"post_title" text,
	"author_name" text,
	"author_handle" text,
	"author_id" text,
	"text" text NOT NULL,
	"language" text,
	"received_at" timestamp with time zone NOT NULL,
	"category" text,
	"status" text DEFAULT 'new' NOT NULL,
	"reply" text,
	"reply_external_id" text,
	"replied_at" timestamp with time zone,
	"agent_note" text,
	"permalink" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"text" text NOT NULL,
	"evidence" text,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"source" text DEFAULT 'analysis' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"dedupe_key" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "knowledge" (
	"key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"summary" text NOT NULL,
	"addition" text NOT NULL,
	"reason" text NOT NULL,
	"source_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"date" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"client_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"publication_id" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"age_hours" double precision NOT NULL,
	"metrics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"client_id" text NOT NULL,
	"code_verifier" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"content_id" text NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"external_id" text,
	"permalink" text,
	"caption" text DEFAULT '' NOT NULL,
	"first_comment" text,
	"media_url" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"metrics" jsonb,
	"metrics_updated_at" timestamp with time zone,
	"checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"route" text DEFAULT 'direct' NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"client_id" text,
	"summary" text NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"text" text NOT NULL,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"aim" text,
	"language" text,
	"budget_usd" double precision,
	"status" text DEFAULT 'new' NOT NULL,
	"concept_count" integer DEFAULT 0 NOT NULL,
	"angles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"job_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"scope" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_hash" text,
	"last_content" text,
	"last_checked_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_snapshots" ADD CONSTRAINT "audience_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedupe_uq" ON "alerts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_read_idx" ON "alerts" USING btree ("read","created_at");--> statement-breakpoint
CREATE INDEX "assets_content_idx" ON "assets" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "audience_client_idx" ON "audience_snapshots" USING btree ("client_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_thread_seq_uq" ON "chat_messages" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_client_platform_uq" ON "connections" USING btree ("client_id","platform");--> statement-breakpoint
CREATE INDEX "content_client_status_idx" ON "content_items" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "content_scheduled_idx" ON "content_items" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "experiments_client_idx" ON "experiments" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "gen_tasks_content_idx" ON "generation_tasks" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "gen_tasks_status_idx" ON "generation_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "goals_client_idx" ON "goals" USING btree ("client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_platform_external_uq" ON "inbox_items" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "inbox_client_status_idx" ON "inbox_items" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "insights_client_idx" ON "insights" USING btree ("client_id","active");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedupe_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_client_platform_date_uq" ON "kpi_snapshots" USING btree ("client_id","platform","date");--> statement-breakpoint
CREATE INDEX "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "metric_snapshots_pub_idx" ON "metric_snapshots" USING btree ("publication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_content_platform_uq" ON "publications" USING btree ("content_id","platform");--> statement-breakpoint
CREATE INDEX "publications_due_idx" ON "publications" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "runs_started_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "scenarios_client_idx" ON "scenarios" USING btree ("client_id","status");