import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { goalPace } from "@/domain/analytics";
import type { ContentStatus, Platform } from "@/domain/types";
import { config } from "./config";
import { getDb } from "./db/client";
import {
  alerts,
  assets,
  chatThreads,
  audienceSnapshots,
  clients,
  connections,
  contentItems,
  experiments,
  generationTasks,
  goals,
  inboxItems,
  insights,
  jobs,
  knowledge,
  knowledgeProposals,
  kpiSnapshots,
  llmUsage,
  publications,
  runs,
  scenarios,
  schedules,
  watchSources,
} from "./db/schema";
import { getModels } from "./generation/models";
import { ensureKnowledge } from "./knowledge";
import { kpiSeries, postSamples } from "./pipeline/context";
import { capabilities } from "./pipeline/production";
import { getNotificationPrefs, getPrices } from "./settings";

export async function navCounts() {
  const db = await getDb();
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(contentItems).where(inArray(contentItems.status, ["concept", "review"]));
  const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(inboxItems).where(inArray(inboxItems.status, ["needs_you", "drafted"]));
  const [h] = await db.select({ n: sql<number>`count(*)::int` }).from(alerts).where(and(eq(alerts.read, false), inArray(alerts.importance, ["high", "medium"])));
  return { approvals: Number(a?.n ?? 0), inbox: Number(i?.n ?? 0), alerts: Number(h?.n ?? 0) };
}

export async function clientNames(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select({ id: clients.id, name: clients.name }).from(clients);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function todayData() {
  const db = await getDb();
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const names = await clientNames();
  const allClients = await db.select().from(clients).orderBy(asc(clients.name));
  const activeGoals = await db.select().from(goals).where(eq(goals.status, "active"));
  const goalsByClient = new Map(activeGoals.map((g) => [g.clientId, g]));
  const waiting = await db
    .select({ id: contentItems.id, title: contentItems.title, status: contentItems.status, format: contentItems.format, clientId: contentItems.clientId, quote: contentItems.quote, updatedAt: contentItems.updatedAt })
    .from(contentItems)
    .where(inArray(contentItems.status, ["concept", "review", "failed"]))
    .orderBy(desc(contentItems.updatedAt))
    .limit(12);
  const needsYou = await db.select().from(inboxItems).where(eq(inboxItems.status, "needs_you")).orderBy(desc(inboxItems.receivedAt)).limit(5);
  const highAlerts = await db.select().from(alerts).where(and(eq(alerts.read, false), eq(alerts.importance, "high"))).orderBy(desc(alerts.createdAt)).limit(5);
  const upcoming = await db
    .select({ pub: publications, title: contentItems.title, format: contentItems.format })
    .from(publications)
    .innerJoin(contentItems, eq(publications.contentId, contentItems.id))
    .where(and(inArray(publications.status, ["scheduled", "publishing"]), gte(publications.scheduledAt, new Date(now.getTime() - 3_600_000)), lte(publications.scheduledAt, week)))
    .orderBy(asc(publications.scheduledAt))
    .limit(14);
  const activity = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(12);
  const producing = await db.select({ id: contentItems.id, title: contentItems.title, clientId: contentItems.clientId }).from(contentItems).where(inArray(contentItems.status, ["greenlit", "producing"]));
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [spendGen] = await db.select({ usd: sql<number>`coalesce(sum(${contentItems.actualCostUsd}),0)` }).from(contentItems).where(gte(contentItems.updatedAt, weekAgo));
  const [spendLlm] = await db.select({ usd: sql<number>`coalesce(sum(${llmUsage.costUsd}),0)` }).from(llmUsage).where(gte(llmUsage.createdAt, weekAgo));
  return {
    clients: allClients.map((c) => ({ ...c, goal: goalsByClient.get(c.id) ?? null })),
    waiting: waiting.map((w) => ({ ...w, client: names.get(w.clientId) ?? w.clientId })),
    needsYou: needsYou.map((n) => ({ ...n, client: names.get(n.clientId) ?? n.clientId })),
    highAlerts,
    upcoming: upcoming.map((u) => ({ ...u.pub, title: u.title, format: u.format, client: names.get(u.pub.clientId) ?? u.pub.clientId })),
    activity: activity.map((a) => ({ ...a, client: a.clientId ? (names.get(a.clientId) ?? a.clientId) : null })),
    producing: producing.map((p) => ({ ...p, client: names.get(p.clientId) ?? p.clientId })),
    spendWeekUsd: Number(spendGen?.usd ?? 0) + Number(spendLlm?.usd ?? 0),
    demo: config().demo,
  };
}

export async function scenariosList(limit = 30) {
  const db = await getDb();
  const names = await clientNames();
  const rows = await db.select().from(scenarios).orderBy(desc(scenarios.createdAt)).limit(limit);
  return rows.map((r) => ({ ...r, client: names.get(r.clientId) ?? r.clientId }));
}

export async function approvalsData() {
  const db = await getDb();
  const names = await clientNames();
  const rows = await db
    .select()
    .from(contentItems)
    .where(inArray(contentItems.status, ["concept", "revise", "review", "greenlit", "producing", "failed"]))
    .orderBy(asc(contentItems.scheduledAt));
  const withClient = rows.map((r) => ({ ...r, client: names.get(r.clientId) ?? r.clientId }));
  return {
    concepts: withClient.filter((r) => r.status === "concept"),
    cuts: withClient.filter((r) => r.status === "review"),
    working: withClient.filter((r) => ["revise", "greenlit", "producing"].includes(r.status)),
    failed: withClient.filter((r) => r.status === "failed"),
  };
}

export async function contentDetail(id: string) {
  const db = await getDb();
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, id));
  if (!item) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, item.clientId));
  const pubs = await db.select().from(publications).where(eq(publications.contentId, id)).orderBy(asc(publications.platform));
  const tasks = await db.select().from(generationTasks).where(eq(generationTasks.contentId, id)).orderBy(asc(generationTasks.createdAt));
  const scenario = item.scenarioId ? (await db.select().from(scenarios).where(eq(scenarios.id, item.scenarioId)))[0] : undefined;
  const conns = await db.select({ platform: connections.platform, route: connections.route, status: connections.status, mode: connections.mode }).from(connections).where(eq(connections.clientId, item.clientId));
  const files = await db.select().from(assets).where(eq(assets.contentId, id)).orderBy(asc(assets.createdAt));
  return { item, client, pubs, tasks, scenario, connections: conns, files };
}

export async function calendarData(from: Date, to: Date, clientId?: string) {
  const db = await getDb();
  const names = await clientNames();
  const items = await db
    .select()
    .from(contentItems)
    .where(
      and(
        gte(contentItems.scheduledAt, from),
        lte(contentItems.scheduledAt, to),
        inArray(contentItems.status, ["concept", "greenlit", "producing", "review", "approved", "scheduled", "live", "analyzed", "revise"]),
        clientId ? eq(contentItems.clientId, clientId) : undefined,
      ),
    )
    .orderBy(asc(contentItems.scheduledAt));
  const pubs = items.length ? await db.select().from(publications).where(inArray(publications.contentId, items.map((i) => i.id))) : [];
  return items.map((i) => ({ ...i, client: names.get(i.clientId) ?? i.clientId, pubs: pubs.filter((p) => p.contentId === i.id) }));
}

export async function analyticsData(clientId: string, days = 30) {
  const db = await getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return null;
  const [goal] = await db.select().from(goals).where(and(eq(goals.clientId, clientId), eq(goals.status, "active"))).orderBy(desc(goals.createdAt)).limit(1);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const kpis = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.clientId, clientId), gte(kpiSnapshots.date, since))).orderBy(asc(kpiSnapshots.date));
  const samples = await postSamples(clientId, days);
  const series = goal ? await kpiSeries(clientId, goal) : [];
  const pace = goal ? goalPace({ kpi: goal.kpi, target: goal.target, baseline: goal.baseline, startDate: goal.startDate, deadline: goal.deadline }, series, new Date()) : null;
  const audience = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.clientId, clientId)).orderBy(desc(audienceSnapshots.capturedAt)).limit(8);
  const latestAudience = new Map<Platform, (typeof audience)[number]>();
  for (const a of audience) if (!latestAudience.has(a.platform)) latestAudience.set(a.platform, a);
  const exps = await db.select().from(experiments).where(eq(experiments.clientId, clientId)).orderBy(desc(experiments.startedAt)).limit(12);
  const learned = await db.select().from(insights).where(and(eq(insights.clientId, clientId), eq(insights.active, true))).orderBy(desc(insights.createdAt)).limit(15);
  const lastReview = await db.select().from(runs).where(and(eq(runs.clientId, clientId), inArray(runs.kind, ["review", "pivot"]))).orderBy(desc(runs.startedAt)).limit(1);
  return { client, goal: goal ?? null, pace, series, kpis, samples, audience: [...latestAudience.values()], experiments: exps, insights: learned, lastReview: lastReview[0] ?? null };
}

export async function inboxData(filter: "attention" | "all" | "sent" = "attention") {
  const db = await getDb();
  const names = await clientNames();
  const where =
    filter === "attention" ? inArray(inboxItems.status, ["needs_you", "drafted", "failed", "new"]) : filter === "sent" ? inArray(inboxItems.status, ["sent", "hidden", "skipped"]) : undefined;
  const rows = await db.select().from(inboxItems).where(where).orderBy(desc(inboxItems.receivedAt)).limit(100);
  return rows.map((r) => ({ ...r, client: names.get(r.clientId) ?? r.clientId }));
}

export async function alertsData() {
  const db = await getDb();
  const names = await clientNames();
  const rows = await db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(80);
  const proposals = await db.select().from(knowledgeProposals).where(eq(knowledgeProposals.status, "pending")).orderBy(desc(knowledgeProposals.createdAt));
  return { alerts: rows.map((r) => ({ ...r, client: r.clientId ? (names.get(r.clientId) ?? r.clientId) : null })), proposals };
}

export async function clientsList() {
  const db = await getDb();
  const rows = await db.select().from(clients).orderBy(asc(clients.name));
  const conns = await db.select({ clientId: connections.clientId, platform: connections.platform, status: connections.status, mode: connections.mode }).from(connections);
  const gs = await db.select().from(goals).where(eq(goals.status, "active"));
  return rows.map((c) => ({ ...c, connections: conns.filter((x) => x.clientId === c.id), goal: gs.find((g) => g.clientId === c.id) ?? null }));
}

export async function clientDetail(id: string) {
  const db = await getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, id));
  if (!client) return null;
  const conns = await db.select().from(connections).where(eq(connections.clientId, id));
  const goalRows = await db.select().from(goals).where(eq(goals.clientId, id)).orderBy(desc(goals.createdAt)).limit(5);
  const counts = await db.select({ status: contentItems.status, n: sql<number>`count(*)::int` }).from(contentItems).where(eq(contentItems.clientId, id)).groupBy(contentItems.status);
  return {
    client,
    connections: conns.map((c) => ({ ...c, accessTokenEnc: undefined, refreshTokenEnc: undefined })),
    goals: goalRows,
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) as Partial<Record<ContentStatus, number>>,
  };
}

export async function settingsData() {
  const db = await getDb();
  await ensureKnowledge();
  const cfg = config();
  const caps = capabilities();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const usage = await db
    .select({ task: llmUsage.task, n: sql<number>`count(*)::int`, usd: sql<number>`coalesce(sum(${llmUsage.costUsd}),0)` })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, monthAgo))
    .groupBy(llmUsage.task);
  return {
    integrations: {
      claude: { ok: Boolean(cfg.claude.apiKey), detail: cfg.claude.apiKey ? `${cfg.claude.model} · fallbacks ${cfg.claude.fallbacks}` : "ANTHROPIC_API_KEY not set — demo mode" },
      higgsfield: { ok: caps.higgsfield, detail: caps.higgsfield ? cfg.higgsfield.baseUrl : "HIGGSFIELD_CREDENTIALS not set" },
      elevenlabs: { ok: caps.elevenlabs, detail: caps.elevenlabs ? "eleven_v3 voice, music, SFX" : "ELEVENLABS_API_KEY not set" },
      meta: { ok: Boolean(cfg.meta.appId && cfg.meta.appSecret), detail: cfg.meta.appId ? `Graph ${cfg.meta.graphVersion}` : "META_APP_ID / META_APP_SECRET not set" },
      linkedin: { ok: Boolean(cfg.linkedin.clientId && cfg.linkedin.clientSecret), detail: cfg.linkedin.clientId ? `API version ${cfg.linkedin.apiVersion}` : "LINKEDIN_CLIENT_ID / SECRET not set" },
      x: { ok: Boolean(cfg.x.clientId), detail: cfg.x.clientId ? "OAuth 2.0 PKCE" : "X_CLIENT_ID not set" },
      metricool: { ok: Boolean(cfg.metricool.userToken && cfg.metricool.userId), detail: cfg.metricool.userToken ? "Publishing route available" : "Optional — METRICOOL_USER_TOKEN / USER_ID" },
      storage: { ok: cfg.storage.driver === "s3" || cfg.appUrl.startsWith("https://"), detail: cfg.storage.driver === "s3" ? `S3 bucket ${cfg.storage.s3.bucket}` : `Local files served from ${cfg.appUrl}/api/media` },
      push: { ok: Boolean(cfg.push.publicKey && cfg.push.privateKey), detail: cfg.push.publicKey ? "Web Push (VAPID) ready" : "Run npm run vapid and set VAPID keys" },
      telegram: { ok: Boolean(cfg.telegram.botToken && cfg.telegram.chatId), detail: cfg.telegram.botToken ? "Telegram notifications on" : "Optional" },
    },
    demo: cfg.demo,
    appUrl: cfg.appUrl,
    pushPublicKey: cfg.push.publicKey ?? null,
    models: await getModels(),
    prices: await getPrices(),
    notifications: await getNotificationPrefs(),
    schedules: await db.select().from(schedules).orderBy(asc(schedules.name)),
    sources: await db.select().from(watchSources).orderBy(asc(watchSources.name)),
    usage: usage.map((u) => ({ task: u.task, calls: Number(u.n), usd: Number(u.usd) })),
    queue: await db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status),
  };
}

export async function playbooksData() {
  await ensureKnowledge();
  const db = await getDb();
  return db.select().from(knowledge).orderBy(asc(knowledge.key));
}

export async function chatThreadsList(limit = 20) {
  const db = await getDb();
  return db.select().from(chatThreads).orderBy(desc(chatThreads.updatedAt)).limit(limit);
}
