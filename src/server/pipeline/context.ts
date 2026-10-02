import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { ClientContext } from "@/agent/context";
import { diagnose, engagementRate, goalPace, kpiValueFromAccount, type PostSample } from "@/domain/analytics";
import type { AccountMetrics, Format, Platform, PostMetrics } from "@/domain/types";
import { getDb } from "../db/client";
import {
  audienceSnapshots,
  clients,
  connections,
  contentItems,
  experiments,
  goals,
  insights,
  kpiSnapshots,
  publications,
  type ClientRow,
  type GoalRow,
} from "../db/schema";

/** Sum per-platform account metrics into one KPI series (or a single platform when the goal names one). */
export async function kpiSeries(clientId: string, goal: GoalRow): Promise<Array<{ date: Date; value: number }>> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(kpiSnapshots)
    .where(and(eq(kpiSnapshots.clientId, clientId), goal.platform ? eq(kpiSnapshots.platform, goal.platform) : undefined));
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const v = kpiValueFromAccount(goal.kpi, r.metrics as AccountMetrics);
    if (v === undefined) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + v);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date: new Date(`${date}T12:00:00Z`), value })).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Published posts with metrics, as analytics samples (one per publication). */
export async function postSamples(clientId: string, sinceDays = 60, platform?: Platform | null): Promise<Array<PostSample & { contentId: string; title: string; angle: string | null; experimentId: string | null }>> {
  const db = await getDb();
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db
    .select({
      pub: publications,
      content: { id: contentItems.id, title: contentItems.title, angle: contentItems.angle, format: contentItems.format, experimentId: contentItems.experimentId, production: contentItems.production },
    })
    .from(publications)
    .innerJoin(contentItems, eq(publications.contentId, contentItems.id))
    .where(
      and(
        eq(publications.clientId, clientId),
        eq(publications.status, "published"),
        isNotNull(publications.metrics),
        gte(publications.publishedAt, since),
        platform ? eq(publications.platform, platform) : undefined,
      ),
    );
  const followers = await latestFollowers(clientId);
  return rows.map((r) => ({
    id: r.pub.id,
    contentId: r.content.id,
    title: r.content.title,
    angle: r.content.angle,
    experimentId: r.content.experimentId,
    platform: r.pub.platform,
    format: r.content.format as Format,
    publishedAt: r.pub.publishedAt ?? r.pub.scheduledAt,
    metrics: (r.pub.metrics ?? {}) as PostMetrics,
    followersAtPost: followers[r.pub.platform],
    durationSec: r.content.production?.durationSec || undefined,
  }));
}

export async function latestFollowers(clientId: string): Promise<Partial<Record<Platform, number>>> {
  const db = await getDb();
  const rows = await db.select().from(kpiSnapshots).where(eq(kpiSnapshots.clientId, clientId)).orderBy(desc(kpiSnapshots.date)).limit(40);
  const out: Partial<Record<Platform, number>> = {};
  for (const r of rows) {
    const f = (r.metrics as AccountMetrics).followers;
    if (f !== undefined && out[r.platform] === undefined) out[r.platform] = f;
  }
  return out;
}

export async function activeGoal(clientId: string): Promise<GoalRow | undefined> {
  const db = await getDb();
  const [g] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.clientId, clientId), eq(goals.status, "active")))
    .orderBy(desc(goals.createdAt))
    .limit(1);
  return g;
}

export async function connectedPlatforms(clientId: string): Promise<Platform[]> {
  const db = await getDb();
  const rows = await db
    .select({ platform: connections.platform, status: connections.status })
    .from(connections)
    .where(eq(connections.clientId, clientId));
  return rows.filter((r) => r.platform !== "metricool" && r.status !== "revoked").map((r) => r.platform as Platform);
}

export async function loadClient(clientId: string): Promise<ClientRow> {
  const db = await getDb();
  const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!c) throw new Error(`Client ${clientId} not found`);
  return c;
}

/** Assemble everything the agent knows about a client. */
export async function buildClientContext(clientId: string, now = new Date()): Promise<ClientContext> {
  const db = await getDb();
  const client = await loadClient(clientId);
  const goal = await activeGoal(clientId);
  const samples = await postSamples(clientId, 60, goal?.platform);
  const series = goal ? await kpiSeries(clientId, goal) : [];
  const pace = goal
    ? goalPace({ kpi: goal.kpi, target: goal.target, baseline: goal.baseline, startDate: goal.startDate, deadline: goal.deadline }, series, now)
    : null;
  const diagnosis = samples.length >= 3 ? diagnose(samples, goal?.kpi ?? "reach") : null;

  const [insightRows, experimentRows, recentRows, audienceRow] = await Promise.all([
    db.select().from(insights).where(and(eq(insights.clientId, clientId), eq(insights.active, true))).orderBy(desc(insights.createdAt)).limit(25),
    db
      .select()
      .from(experiments)
      .where(and(eq(experiments.clientId, clientId), inArray(experiments.status, ["running", "proposed"])))
      .orderBy(desc(experiments.startedAt)),
    db.select().from(contentItems).where(eq(contentItems.clientId, clientId)).orderBy(desc(contentItems.createdAt)).limit(20),
    db.select().from(audienceSnapshots).where(eq(audienceSnapshots.clientId, clientId)).orderBy(desc(audienceSnapshots.capturedAt)).limit(1),
  ]);

  return {
    client: {
      id: client.id,
      name: client.name,
      timezone: client.timezone,
      languages: client.languages,
      website: client.website,
      industry: client.industry,
      brief: client.brief,
      autonomy: client.autonomy,
    },
    goal: goal
      ? {
          id: goal.id,
          statement: goal.statement,
          kpi: goal.kpi,
          platform: goal.platform,
          target: goal.target,
          baseline: goal.baseline,
          current: goal.current,
          startDate: goal.startDate,
          deadline: goal.deadline,
          pace: goal.pace,
          agentRead: goal.agentRead,
        }
      : null,
    pace,
    diagnosis,
    insights: insightRows.map((i) => ({ text: i.text, confidence: i.confidence, evidence: i.evidence })),
    experiments: experimentRows.map((e) => ({ id: e.id, lever: e.lever, change: e.change, expected: e.expected, metric: e.metric, reviewOn: e.reviewOn, status: e.status, bottleneck: e.bottleneck })),
    recent: recentRows.map((r) => {
      const perf = r.performance ?? undefined;
      return {
        title: r.title,
        angle: r.angle,
        format: r.format,
        platforms: r.platforms,
        status: r.status,
        publishedAt: r.status === "live" || r.status === "analyzed" ? r.scheduledAt : null,
        engagementRate: perf ? (perf.engagementRate ?? engagementRate(perf)) : undefined,
        reach: perf?.reach,
        views: perf?.views,
        saves: perf?.saves,
        shares: perf?.shares,
        follows: perf?.follows,
        profileVisits: perf?.profileVisits,
      };
    }),
    audience: audienceRow[0] ? { platform: audienceRow[0].platform, data: audienceRow[0].data } : null,
    connected: await connectedPlatforms(clientId),
    now,
  };
}
