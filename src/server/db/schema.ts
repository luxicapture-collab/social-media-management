import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Captions, Concept, ProductionPlan } from "@/domain/schemas";
import type {
  AccountMetrics,
  AlertImportance,
  AlertKind,
  AudienceBreakdown,
  Bottleneck,
  ClientAutonomy,
  ClientBrief,
  ContentStatus,
  Format,
  GoalKpi,
  InboxCategory,
  InboxKind,
  InboxStatus,
  PaceStatus,
  Platform,
  PostMetrics,
  PublicationStatus,
  Quote,
  ScenarioStatus,
} from "@/domain/types";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Key/value settings (model registry, price table, notification prefs...). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull(),
  status: text("status").$type<"onboarding" | "active" | "paused">().notNull().default("onboarding"),
  timezone: text("timezone").notNull().default("UTC"),
  languages: jsonb("languages").$type<string[]>().notNull().default(["en"]),
  website: text("website"),
  industry: text("industry"),
  brief: jsonb("brief").$type<ClientBrief>().notNull(),
  autonomy: jsonb("autonomy").$type<ClientAutonomy>().notNull(),
  /** The agent's latest plain-language read of where the goal stands. */
  agentRead: text("agent_read"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const goals = pgTable(
  "goals",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    kpi: text("kpi").$type<GoalKpi>().notNull(),
    platform: text("platform").$type<Platform | null>(),
    target: doublePrecision("target").notNull(),
    baseline: doublePrecision("baseline"),
    current: doublePrecision("current"),
    startDate: ts("start_date").notNull(),
    deadline: ts("deadline").notNull(),
    status: text("status").$type<"active" | "achieved" | "missed" | "archived">().notNull().default("active"),
    pace: text("pace").$type<PaceStatus>().notNull().default("unknown"),
    behindStreak: integer("behind_streak").notNull().default(0),
    agentRead: text("agent_read"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goals_client_idx").on(t.clientId, t.status)],
);

export const connections = pgTable(
  "connections",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform | "metricool">().notNull(),
    /** IG user id, FB page id, LinkedIn author URN, X user id, Metricool blogId. */
    accountId: text("account_id").notNull(),
    accountName: text("account_name"),
    handle: text("handle"),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    /** demo = simulated account used in demo mode. */
    mode: text("mode").$type<"live" | "demo">().notNull().default("live"),
    /** Publish route: post directly via the platform API, or hand off to Metricool. */
    route: text("route").$type<"direct" | "metricool">().notNull().default("direct"),
    status: text("status").$type<"connected" | "error" | "expired" | "revoked">().notNull().default("connected"),
    lastError: text("last_error"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("connections_client_platform_uq").on(t.clientId, t.platform)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  platform: text("platform").notNull(),
  clientId: text("client_id").notNull(),
  codeVerifier: text("code_verifier"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const scenarios = pgTable(
  "scenarios",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    formats: jsonb("formats").$type<Format[]>().notNull().default([]),
    platforms: jsonb("platforms").$type<Platform[]>().notNull().default([]),
    windowStart: ts("window_start"),
    windowEnd: ts("window_end"),
    aim: text("aim"),
    language: text("language"),
    budgetUsd: doublePrecision("budget_usd"),
    status: text("status").$type<ScenarioStatus>().notNull().default("new"),
    conceptCount: integer("concept_count").notNull().default(0),
    /** Angles considered (≥5) with scores, kept for transparency. */
    angles: jsonb("angles").$type<Array<{ angle: string; idea: string; score: number; why: string }>>().notNull().default([]),
    agentNote: text("agent_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("scenarios_client_idx").on(t.clientId, t.status)],
);

export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id").references(() => scenarios.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    angle: text("angle"),
    format: text("format").$type<Format>().notNull(),
    platforms: jsonb("platforms").$type<Platform[]>().notNull(),
    status: text("status").$type<ContentStatus>().notNull().default("concept"),
    revisionOf: text("revision_of").$type<"concept" | "cut" | null>(),
    revisionNote: text("revision_note"),
    hook: text("hook").notNull().default(""),
    beats: jsonb("beats").$type<string[]>().notNull().default([]),
    rationale: text("rationale").notNull().default(""),
    captions: jsonb("captions").$type<Captions>().notNull(),
    storyFrames: jsonb("story_frames").$type<Array<{ text: string; sticker: string }>>().notNull().default([]),
    firstComments: jsonb("first_comments").$type<Partial<Record<Platform, string>>>().notNull().default({}),
    production: jsonb("production").$type<ProductionPlan>(),
    quote: jsonb("quote").$type<Quote>(),
    actualCostUsd: doublePrecision("actual_cost_usd").notNull().default(0),
    language: text("language").notNull().default("en"),
    trialReel: boolean("trial_reel").notNull().default(false),
    experimentId: text("experiment_id"),
    critique: jsonb("critique").$type<{ score: number; notes: string[] } | null>(),
    scheduledAt: ts("scheduled_at"),
    /** Final deliverables, one entry per variant. */
    media: jsonb("media")
      .$type<Array<{ kind: "video" | "image" | "pdf"; assetId: string; url: string; aspect?: string; platform?: Platform; coverUrl?: string; role?: string }>>()
      .notNull()
      .default([]),
    performance: jsonb("performance").$type<PostMetrics & { engagementRate?: number; updatedAt?: string }>(),
    agentNote: text("agent_note"),
    concept: jsonb("concept").$type<Concept | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_client_status_idx").on(t.clientId, t.status), index("content_scheduled_idx").on(t.scheduledAt)],
);

export const publications = pgTable(
  "publications",
  {
    id: id(),
    contentId: text("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    status: text("status").$type<PublicationStatus>().notNull().default("pending"),
    scheduledAt: ts("scheduled_at").notNull(),
    publishedAt: ts("published_at"),
    externalId: text("external_id"),
    permalink: text("permalink"),
    caption: text("caption").notNull().default(""),
    firstComment: text("first_comment"),
    mediaUrl: text("media_url"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    metrics: jsonb("metrics").$type<PostMetrics>(),
    metricsUpdatedAt: ts("metrics_updated_at"),
    checkpoints: jsonb("checkpoints").$type<Record<string, string>>().notNull().default({}),
    route: text("route").$type<"direct" | "metricool">().notNull().default("direct"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("publications_content_platform_uq").on(t.contentId, t.platform),
    index("publications_due_idx").on(t.status, t.scheduledAt),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    contentId: text("content_id").references(() => contentItems.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"image" | "video" | "audio" | "subtitle" | "pdf">().notNull(),
    role: text("role").notNull(),
    storageKey: text("storage_key").notNull(),
    url: text("url").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes"),
    width: integer("width"),
    height: integer("height"),
    durationSec: doublePrecision("duration_sec"),
    source: text("source").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("assets_content_idx").on(t.contentId)],
);

export const generationTasks = pgTable(
  "generation_tasks",
  {
    id: id(),
    contentId: text("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    provider: text("provider").$type<"higgsfield" | "elevenlabs" | "demo">().notNull(),
    kind: text("kind").$type<"image" | "video" | "tts" | "music" | "sfx">().notNull(),
    key: text("key").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    dependsOn: text("depends_on"),
    externalId: text("external_id"),
    status: text("status").$type<"queued" | "submitted" | "completed" | "failed" | "canceled">().notNull().default("queued"),
    assetId: text("asset_id"),
    estCostUsd: doublePrecision("est_cost_usd").notNull().default(0),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("gen_tasks_content_idx").on(t.contentId), index("gen_tasks_status_idx").on(t.status)],
);

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: id(),
    publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    ageHours: doublePrecision("age_hours").notNull(),
    metrics: jsonb("metrics").$type<PostMetrics>().notNull(),
  },
  (t) => [index("metric_snapshots_pub_idx").on(t.publicationId)],
);

export const kpiSnapshots = pgTable(
  "kpi_snapshots",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    date: text("date").notNull(),
    metrics: jsonb("metrics").$type<AccountMetrics>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("kpi_client_platform_date_uq").on(t.clientId, t.platform, t.date)],
);

export const audienceSnapshots = pgTable(
  "audience_snapshots",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    data: jsonb("data").$type<AudienceBreakdown>().notNull(),
  },
  (t) => [index("audience_client_idx").on(t.clientId, t.platform)],
);

export const experiments = pgTable(
  "experiments",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    goalId: text("goal_id"),
    kind: text("kind").$type<"major" | "micro">().notNull().default("major"),
    bottleneck: text("bottleneck").$type<Bottleneck>(),
    lever: text("lever").notNull(),
    finding: text("finding").notNull(),
    change: text("change").notNull(),
    expected: text("expected").notNull(),
    metric: text("metric").notNull(),
    baselineValue: doublePrecision("baseline_value"),
    resultValue: doublePrecision("result_value"),
    status: text("status").$type<"proposed" | "running" | "kept" | "reverted" | "inconclusive" | "rejected">().notNull().default("running"),
    startedAt: ts("started_at").notNull().defaultNow(),
    reviewOn: ts("review_on").notNull(),
    result: text("result"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("experiments_client_idx").on(t.clientId, t.status)],
);

/** Durable learnings the strategist reads before every plan ("BTS reels with cold opens: 2.3× reach"). */
export const insights = pgTable(
  "insights",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    evidence: text("evidence"),
    confidence: text("confidence").$type<"low" | "medium" | "high">().notNull().default("medium"),
    source: text("source").$type<"experiment" | "analysis" | "user">().notNull().default("analysis"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("insights_client_idx").on(t.clientId, t.active)],
);

export const inboxItems = pgTable(
  "inbox_items",
  {
    id: id(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    kind: text("kind").$type<InboxKind>().notNull(),
    externalId: text("external_id").notNull(),
    threadId: text("thread_id"),
    parentExternalId: text("parent_external_id"),
    postExternalId: text("post_external_id"),
    postTitle: text("post_title"),
    authorName: text("author_name"),
    authorHandle: text("author_handle"),
    authorId: text("author_id"),
    text: text("text").notNull(),
    language: text("language"),
    receivedAt: ts("received_at").notNull(),
    category: text("category").$type<InboxCategory>(),
    status: text("status").$type<InboxStatus>().notNull().default("new"),
    reply: text("reply"),
    replyExternalId: text("reply_external_id"),
    repliedAt: ts("replied_at"),
    agentNote: text("agent_note"),
    permalink: text("permalink"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("inbox_platform_external_uq").on(t.platform, t.externalId),
    index("inbox_client_status_idx").on(t.clientId, t.status),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    clientId: text("client_id"),
    kind: text("kind").$type<AlertKind>().notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    action: text("action"),
    importance: text("importance").$type<AlertImportance>().notNull(),
    url: text("url"),
    read: boolean("read").notNull().default(false),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("alerts_dedupe_uq").on(t.dedupeKey), index("alerts_read_idx").on(t.read, t.createdAt)],
);

export const watchSources = pgTable("watch_sources", {
  id: id(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  scope: text("scope").$type<"platform" | "tool" | "industry">().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastHash: text("last_hash"),
  lastContent: text("last_content"),
  lastCheckedAt: ts("last_checked_at"),
  lastChangedAt: ts("last_changed_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/** Editable playbooks the agent reads (seeded from /playbooks). Self-updates land here after approval. */
export const knowledge = pgTable("knowledge", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  source: text("source").notNull().default("seed"),
  updatedAt: updatedAt(),
});

export const knowledgeProposals = pgTable("knowledge_proposals", {
  id: id(),
  key: text("key").notNull(),
  summary: text("summary").notNull(),
  addition: text("addition").notNull(),
  reason: text("reason").notNull(),
  sourceUrl: text("source_url"),
  status: text("status").$type<"pending" | "applied" | "rejected">().notNull().default("pending"),
  createdAt: createdAt(),
  decidedAt: ts("decided_at"),
});

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    runAt: ts("run_at").notNull().defaultNow(),
    status: text("status").$type<"queued" | "running" | "done" | "failed" | "dead">().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    dedupeKey: text("dedupe_key"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("jobs_due_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_active_dedupe_uq").on(t.dedupeKey).where(sql`${t.status} in ('queued', 'running')`),
  ],
);

export const schedules = pgTable("schedules", {
  name: text("name").primaryKey(),
  cron: text("cron").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  jobType: text("job_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: ts("last_run_at"),
  nextRunAt: ts("next_run_at"),
});

/** Agent activity log shown on the Today screen. */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    kind: text("kind").notNull(),
    clientId: text("client_id"),
    summary: text("summary").notNull(),
    ok: boolean("ok").notNull().default(true),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("runs_started_idx").on(t.startedAt)],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const chatThreads = pgTable("chat_threads", {
  id: id(),
  title: text("title").notNull(),
  clientId: text("client_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Full API content blocks (incl. thinking/tool blocks) are stored and replayed verbatim. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    threadId: text("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chat_thread_seq_uq").on(t.threadId, t.seq)],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: id(),
    task: text("task").notNull(),
    model: text("model").notNull(),
    clientId: text("client_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("llm_usage_created_idx").on(t.createdAt)],
);

export type ClientRow = typeof clients.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type ScenarioRow = typeof scenarios.$inferSelect;
export type ContentRow = typeof contentItems.$inferSelect;
export type PublicationRow = typeof publications.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type GenerationTaskRow = typeof generationTasks.$inferSelect;
export type ExperimentRow = typeof experiments.$inferSelect;
export type InsightRow = typeof insights.$inferSelect;
export type InboxRow = typeof inboxItems.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type KnowledgeRow = typeof knowledge.$inferSelect;
export type WatchSourceRow = typeof watchSources.$inferSelect;
