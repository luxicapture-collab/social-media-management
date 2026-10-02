import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { detectAnomalies, engagementRate, goalPace, KPI_AGGREGATION } from "@/domain/analytics";
import { addLocalDays, localDateKey, startOfLocalDay } from "@/domain/time";
import type { Format, Platform, PostMetrics } from "@/domain/types";
import { logRun, raiseAlert } from "../activity";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { audienceSnapshots, clients, connections, contentItems, goals, kpiSnapshots, metricSnapshots, publications, type ConnectionRow, type PublicationRow } from "../db/schema";
import { enqueue } from "../jobs/queue";
import { errorMessage, log } from "../log";
import { notify } from "../notify";
import { adapterFor } from "../platforms/registry";
import { PlatformError, type PostRef } from "../platforms/types";
import { freshCtx, recordConnectionFailure } from "../services/connections";
import { activeGoal, kpiSeries } from "./context";

export const CHECKPOINTS = [
  { key: "h6", hours: 6 },
  { key: "h24", hours: 24 },
  { key: "h72", hours: 72 },
  { key: "d7", hours: 168 },
] as const;

export function dueCheckpoint(pub: Pick<PublicationRow, "publishedAt" | "checkpoints">, now = new Date()): (typeof CHECKPOINTS)[number] | null {
  if (!pub.publishedAt) return null;
  const age = (now.getTime() - pub.publishedAt.getTime()) / 3_600_000;
  const due = [...CHECKPOINTS].reverse().find((c) => age >= c.hours && !pub.checkpoints[c.key]);
  return due ?? null;
}

/** Sum counts across platforms; average the ratios. */
export function rollUp(list: PostMetrics[]): PostMetrics & { engagementRate?: number } {
  const out: PostMetrics & { engagementRate?: number } = {};
  const sumKeys: Array<keyof PostMetrics> = ["impressions", "views", "reach", "likes", "comments", "shares", "saves", "clicks", "profileVisits", "follows", "replies", "videoViews"];
  for (const k of sumKeys) {
    const vals = list.map((m) => m[k]).filter((v): v is number => typeof v === "number");
    if (vals.length) out[k] = vals.reduce((a, b) => a + b, 0);
  }
  for (const k of ["avgWatchSec", "retention3s"] as const) {
    const vals = list.map((m) => m[k]).filter((v): v is number => typeof v === "number");
    if (vals.length) out[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  out.engagementRate = engagementRate(out);
  return out;
}

function normaliseCaption(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 40);
}

/** Find the native post that Metricool published for a publication (time ±20 min, caption opening). */
async function matchMetricoolPost(conn: ConnectionRow, pub: PublicationRow): Promise<{ externalId: string; permalink?: string; publishedAt: Date } | null> {
  const ctx = await freshCtx(conn);
  const adapter = adapterFor(pub.platform, ctx);
  if (!adapter.recentPublished) return null;
  const candidates = await adapter.recentPublished(ctx, new Date(pub.scheduledAt.getTime() - 3 * 3_600_000));
  const window = candidates.filter((c) => Math.abs(c.publishedAt.getTime() - pub.scheduledAt.getTime()) <= 20 * 60_000);
  const want = normaliseCaption(pub.caption);
  const match = window.find((c) => want && normaliseCaption(c.caption).startsWith(want.slice(0, 25))) ?? (window.length === 1 ? window[0] : undefined);
  return match ? { externalId: match.externalId, permalink: match.permalink, publishedAt: match.publishedAt } : null;
}

/** Hourly: read post metrics at 6 h / 24 h / 72 h / 7 d; mark content analyzed after 7 days. */
export async function collectPostMetrics(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const since = new Date(Date.now() - 9 * 86_400_000);
  const pubs = await db
    .select({ pub: publications, format: contentItems.format })
    .from(publications)
    .innerJoin(contentItems, eq(publications.contentId, contentItems.id))
    .where(and(eq(publications.status, "published"), gte(publications.publishedAt, since)));
  const now = new Date();
  const groups = new Map<string, Array<{ pub: PublicationRow; format: Format; checkpoint: string }>>();
  for (const { pub, format } of pubs) {
    const cp = dueCheckpoint(pub, now);
    if (!cp) continue;
    const key = `${pub.clientId}:${pub.platform}`;
    groups.set(key, [...(groups.get(key) ?? []), { pub, format: format as Format, checkpoint: cp.key }]);
  }

  let measured = 0;
  const touched = new Set<string>();
  for (const [key, list] of groups) {
    const [clientId, platform] = key.split(":") as [string, Platform];
    const [conn] = await db.select().from(connections).where(and(eq(connections.clientId, clientId), eq(connections.platform, platform)));
    if (!conn) continue;
    try {
      // Resolve Metricool-published posts to native ids first.
      for (const entry of list) {
        if (entry.pub.externalId?.startsWith("metricool:") || !entry.pub.externalId) {
          const m = await matchMetricoolPost(conn, entry.pub).catch(() => null);
          if (m) {
            await db.update(publications).set({ externalId: m.externalId, permalink: m.permalink ?? entry.pub.permalink, publishedAt: m.publishedAt }).where(eq(publications.id, entry.pub.id));
            entry.pub = { ...entry.pub, externalId: m.externalId, publishedAt: m.publishedAt };
          }
        }
      }
      const measurable = list.filter((e) => e.pub.externalId && !e.pub.externalId.startsWith("metricool:"));
      if (!measurable.length) continue;
      const ctx = await freshCtx(conn);
      const refs: PostRef[] = measurable.map((e) => ({ externalId: e.pub.externalId!, format: e.format, publishedAt: e.pub.publishedAt! }));
      const metrics = await adapterFor(platform, ctx).postMetrics(ctx, refs);
      for (const e of measurable) {
        const m = metrics[e.pub.externalId!];
        if (!m) continue;
        const ageHours = (now.getTime() - e.pub.publishedAt!.getTime()) / 3_600_000;
        await db.insert(metricSnapshots).values({ id: newId("ms"), publicationId: e.pub.id, ageHours, metrics: m });
        await db
          .update(publications)
          .set({ metrics: m, metricsUpdatedAt: now, checkpoints: { ...e.pub.checkpoints, [e.checkpoint]: now.toISOString() }, updatedAt: now })
          .where(eq(publications.id, e.pub.id));
        touched.add(e.pub.contentId);
        measured++;
      }
    } catch (err) {
      log.warn("metrics.posts_failed", { key, error: errorMessage(err) });
      if (err instanceof PlatformError && err.opts.authExpired) await recordConnectionFailure(conn, err);
    }
  }

  for (const contentId of touched) {
    const ps = await db.select().from(publications).where(and(eq(publications.contentId, contentId), isNotNull(publications.metrics)));
    const perf = rollUp(ps.map((p) => p.metrics as PostMetrics));
    const allFinal = ps.length > 0 && ps.every((p) => p.checkpoints.d7);
    await db
      .update(contentItems)
      .set({ performance: { ...perf, updatedAt: now.toISOString() }, ...(allFinal ? { status: "analyzed" as const } : {}), updatedAt: now })
      .where(eq(contentItems.id, contentId));
  }
  return { measured, contents: touched.size };
}

/** Daily: account KPIs for yesterday (client-local), weekly audience, goal pace, anomalies. */
export async function dailyKpis(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const activeClients = await db.select().from(clients).where(inArray(clients.status, ["active", "onboarding"]));
  const now = new Date();
  let snapshots = 0;
  for (const client of activeClients) {
    const tz = client.timezone;
    const todayStart = startOfLocalDay(now, tz);
    const yesterdayStart = addLocalDays(todayStart, -1, tz);
    const date = localDateKey(yesterdayStart, tz);
    const conns = await db.select().from(connections).where(eq(connections.clientId, client.id));
    for (const conn of conns) {
      if (conn.platform === "metricool") continue;
      const platform = conn.platform as Platform;
      try {
        const ctx = await freshCtx(conn);
        const adapter = adapterFor(platform, ctx);
        const metrics = await adapter.accountMetrics(ctx, yesterdayStart, todayStart);
        await db
          .insert(kpiSnapshots)
          .values({ id: newId("kpi"), clientId: client.id, platform, date, metrics })
          .onConflictDoUpdate({ target: [kpiSnapshots.clientId, kpiSnapshots.platform, kpiSnapshots.date], set: { metrics } });
        snapshots++;
        const [lastAudience] = await db
          .select()
          .from(audienceSnapshots)
          .where(and(eq(audienceSnapshots.clientId, client.id), eq(audienceSnapshots.platform, platform)))
          .orderBy(desc(audienceSnapshots.capturedAt))
          .limit(1);
        if (!lastAudience || now.getTime() - lastAudience.capturedAt.getTime() > 7 * 86_400_000) {
          const audience = await adapter.audience(ctx);
          if (audience) await db.insert(audienceSnapshots).values({ id: newId("aud"), clientId: client.id, platform, data: audience });
        }
        // Anomalies per platform.
        const series = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.clientId, client.id), eq(kpiSnapshots.platform, platform))).orderBy(desc(kpiSnapshots.date)).limit(21);
        for (const a of detectAnomalies(series.map((s) => ({ date: new Date(`${s.date}T12:00:00Z`), followers: s.metrics.followers, reach: s.metrics.reach })))) {
          await raiseAlert({ kind: "goal", source: platform, title: `${client.name}: ${a.message}`, summary: `${a.message} Check recent posts and any account issues on ${platform}.`, importance: "high", url: `/analytics?client=${client.id}`, clientId: client.id, dedupeKey: `anomaly:${client.id}:${platform}:${a.code}:${date}` });
        }
      } catch (err) {
        log.warn("metrics.daily_failed", { client: client.id, platform, error: errorMessage(err) });
        if (err instanceof PlatformError && err.opts.authExpired) await recordConnectionFailure(conn, err);
      }
    }
    await updateGoal(client.id, client.name);
  }
  await logRun({ kind: "measure", summary: `Daily KPIs: ${snapshots} account snapshots across ${activeClients.length} clients.` });
  return { snapshots };
}

export async function updateGoal(clientId: string, clientName: string): Promise<void> {
  const db = await getDb();
  const goal = await activeGoal(clientId);
  if (!goal) return;
  const series = await kpiSeries(clientId, goal);
  const pace = goalPace({ kpi: goal.kpi, target: goal.target, baseline: goal.baseline, startDate: goal.startDate, deadline: goal.deadline }, series, new Date());
  const behind = pace.status === "behind" || pace.status === "off_track";
  const baseline = goal.baseline ?? (series.length ? (KPI_AGGREGATION[goal.kpi] === "level" ? series[0].value : 0) : null);
  const achieved = pace.actual !== null && pace.actual >= goal.target && goal.target > (baseline ?? 0);
  await db
    .update(goals)
    .set({
      current: pace.actual,
      pace: pace.status,
      baseline,
      behindStreak: behind ? goal.behindStreak + 1 : 0,
      status: achieved ? "achieved" : goal.deadline < new Date() ? "missed" : "active",
      updatedAt: new Date(),
    })
    .where(eq(goals.id, goal.id));
  if (achieved) {
    await notify({ title: `Goal hit for ${clientName} 🎯`, body: `${goal.statement} — reached ${pace.actual}.`, url: `/analytics?client=${clientId}`, importance: "high" });
  } else if (behind && goal.behindStreak + 1 >= 2) {
    // Two behind-pace checks in a row → pivot review today.
    await enqueue("strategy.analyze", { clientId, mode: "daily" }, { dedupeKey: `pivot:${clientId}:${new Date().toISOString().slice(0, 10)}` });
  }
}
