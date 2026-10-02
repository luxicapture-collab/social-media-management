import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { analyze } from "@/agent/analyst";
import { getLLM } from "@/agent/llm";
import { engagementRate, experimentLift, median, perPostMetricForKpi } from "@/domain/analytics";
import { learnBestHours } from "@/domain/scheduling";
import { logRun } from "../activity";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { clients, contentItems, experiments, goals, insights } from "../db/schema";
import { enqueue, PermanentJobError } from "../jobs/queue";
import { getKnowledgeBundle } from "../knowledge";
import { notify } from "../notify";
import { buildClientContext, postSamples } from "./context";

function fmt(n: number | undefined, d = 0): string {
  return n === undefined || !Number.isFinite(n) ? "–" : n.toLocaleString("en-US", { maximumFractionDigits: d });
}

/** The measured-data block the analyst reasons over (all numbers computed here, never by the model). */
export async function measuredData(clientId: string, kpi: Parameters<typeof perPostMetricForKpi>[0], tz: string) {
  const db = await getDb();
  const samples = await postSamples(clientId, 45);
  const lines: string[] = [];
  lines.push("Posts (last 45 days, newest first): title | platform | format | date | reach | views | ER% | saves | shares | follows | 3s-retention");
  for (const s of [...samples].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 40)) {
    const m = s.metrics;
    lines.push(
      `- ${s.title} | ${s.platform} | ${s.format} | ${s.publishedAt.toISOString().slice(0, 10)} | ${fmt(m.reach)} | ${fmt(m.views)} | ${fmt(engagementRate(m), 1)} | ${fmt(m.saves)} | ${fmt(m.shares)} | ${fmt(m.follows)} | ${m.retention3s !== undefined ? `${Math.round(m.retention3s * 100)}%` : "–"}${s.experimentId ? ` | exp ${s.experimentId}` : ""}`,
    );
  }
  const byFormat = new Map<string, number[]>();
  const metric = perPostMetricForKpi(kpi);
  for (const s of samples) {
    const v = metric(s);
    if (v !== undefined) byFormat.set(`${s.platform}/${s.format}`, [...(byFormat.get(`${s.platform}/${s.format}`) ?? []), v]);
  }
  lines.push("\nMedian KPI-relevant value by platform/format:");
  for (const [k, v] of byFormat) lines.push(`- ${k}: ${fmt(median(v), 2)} (n=${v.length})`);
  const hours = learnBestHours(samples.filter((s) => s.metrics.reach !== undefined).map((s) => ({ at: s.publishedAt, reach: s.metrics.reach! })), tz);
  lines.push(`\nBest local posting hours by median reach: ${hours.length ? hours.join(", ") : "not enough data"}`);

  const due = await db
    .select()
    .from(experiments)
    .where(and(eq(experiments.clientId, clientId), eq(experiments.status, "running")));
  const reviews: Array<{ id: string; lift: number | null; tagged: number }> = [];
  for (const e of due) {
    const tagged = samples.filter((s) => s.experimentId === e.id);
    const baseline = samples.filter((s) => s.experimentId !== e.id && s.publishedAt < e.startedAt);
    const { lift, taggedMedian, baselineMedian } = experimentLift(tagged, baseline, metric);
    reviews.push({ id: e.id, lift, tagged: tagged.length });
    lines.push(
      `\nExperiment ${e.id} (${e.status}, review ${e.reviewOn.toISOString().slice(0, 10)}${e.reviewOn <= new Date() ? ", DUE" : ""}): ${e.change}. Tagged posts ${tagged.length}; tagged median ${fmt(taggedMedian, 2)} vs baseline ${fmt(baselineMedian, 2)} → lift ${lift === null ? "n/a" : `${Math.round(lift * 100)}%`}`,
    );
  }
  return { text: lines.join("\n"), samples, reviews, bestHours: hours };
}

export async function runAnalysis(payload: { clientId: string; mode?: "daily" | "weekly" }): Promise<Record<string, unknown>> {
  const mode = payload.mode ?? "weekly";
  const db = await getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, payload.clientId));
  if (!client) throw new PermanentJobError("Client not found");
  const ctx = await buildClientContext(client.id);
  const kpi = ctx.goal?.kpi ?? "reach";
  const data = await measuredData(client.id, kpi, client.timezone);
  const weekAgo = new Date(Date.now() - 6 * 86_400_000);
  const recentMajor = await db
    .select()
    .from(experiments)
    .where(and(eq(experiments.clientId, client.id), eq(experiments.kind, "major"), gte(experiments.startedAt, weekAgo)));
  const running = await db.select().from(experiments).where(and(eq(experiments.clientId, client.id), eq(experiments.status, "running"), eq(experiments.kind, "major")));
  const allowNewExperiment = recentMajor.length === 0 && running.every((e) => e.reviewOn <= new Date());

  const playbooks = await getKnowledgeBundle(["strategy", "platforms"]);
  const analysis = await analyze(getLLM(), { ctx, playbooks, data: data.text, mode, allowNewExperiment });

  // 1. Experiment decisions.
  for (const r of analysis.experimentReviews) {
    const exp = running.find((e) => e.id === r.id) ?? (await db.select().from(experiments).where(eq(experiments.id, r.id)))[0];
    if (!exp) continue;
    const measured = data.reviews.find((x) => x.id === r.id);
    if (r.decision === "extend") {
      await db.update(experiments).set({ reviewOn: new Date(Date.now() + 7 * 86_400_000), result: r.result, updatedAt: new Date() }).where(eq(experiments.id, exp.id));
    } else {
      await db
        .update(experiments)
        .set({ status: r.decision === "keep" ? "kept" : "reverted", result: r.result, resultValue: measured?.lift ?? null, updatedAt: new Date() })
        .where(eq(experiments.id, exp.id));
    }
    if (r.insight) {
      await db.insert(insights).values({ id: newId("ins"), clientId: client.id, text: r.insight, evidence: r.result, confidence: r.decision === "keep" ? "high" : "medium", source: "experiment" });
    }
  }

  // 2. At most one new major experiment per week.
  let experimentId: string | null = null;
  if (analysis.newExperiment && allowNewExperiment) {
    const e = analysis.newExperiment;
    experimentId = newId("exp");
    await db.insert(experiments).values({
      id: experimentId,
      clientId: client.id,
      goalId: ctx.goal?.id ?? null,
      kind: "major",
      bottleneck: e.bottleneck,
      lever: e.lever,
      finding: e.finding,
      change: e.change,
      expected: e.expected,
      metric: e.metric,
      status: "running",
      reviewOn: new Date(Date.now() + Math.max(3, e.reviewInDays) * 86_400_000),
    });
  }

  // 3. Micro-adjustments become active guidance for the planner (or wait for approval).
  for (const m of analysis.microAdjustments) {
    if (client.autonomy.autoApplyMicroPivots) {
      await db.insert(insights).values({ id: newId("ins"), clientId: client.id, text: `Micro-adjustment — ${m.lever}: ${m.change}`, evidence: m.why, confidence: "medium", source: "analysis" });
    }
  }
  for (const i of analysis.insights) {
    await db.insert(insights).values({ id: newId("ins"), clientId: client.id, text: i.text, evidence: i.evidence, confidence: i.confidence, source: "analysis" });
  }

  // 4. Goal read.
  await db.update(clients).set({ agentRead: analysis.goalRead, updatedAt: new Date() }).where(eq(clients.id, client.id));
  if (ctx.goal) await db.update(goals).set({ agentRead: analysis.goalRead, updatedAt: new Date() }).where(eq(goals.id, ctx.goal.id));

  // 5. Re-plan unproduced concepts around the pivot.
  let replanned = 0;
  if (analysis.replan.needed && analysis.replan.direction) {
    const upcoming = await db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(and(eq(contentItems.clientId, client.id), inArray(contentItems.status, ["concept"])))
      .orderBy(desc(contentItems.createdAt))
      .limit(6);
    for (const u of upcoming) {
      await db
        .update(contentItems)
        .set({ status: "revise", revisionOf: "concept", revisionNote: `Pivot from the ${mode} review: ${analysis.replan.direction}`, experimentId: experimentId ?? undefined, updatedAt: new Date() })
        .where(eq(contentItems.id, u.id));
      await enqueue("content.revise", { contentId: u.id }, { dedupeKey: `revise:${u.id}` });
      replanned++;
    }
  }

  await logRun({
    kind: mode === "weekly" ? "review" : "pivot",
    clientId: client.id,
    summary: `${client.name}: ${analysis.goalRead}${experimentId ? ` New experiment: ${analysis.newExperiment!.lever}.` : ""}${replanned ? ` Re-planning ${replanned} concepts.` : ""}`,
    details: { analysis, experimentId, replanned },
  });
  if (mode === "weekly" && analysis.weeklyReport) {
    await notify({ title: `Weekly report — ${client.name}`, body: analysis.goalRead, url: `/analytics?client=${client.id}`, importance: "medium", tag: `weekly:${client.id}` });
  } else if (experimentId) {
    await notify({ title: `Pivot for ${client.name}`, body: `${analysis.newExperiment!.lever}: ${analysis.newExperiment!.change}`, url: `/analytics?client=${client.id}`, importance: "medium" });
  }
  return { experimentId, replanned, reviews: analysis.experimentReviews.length };
}

/** Monday: weekly review for every active client. */
export async function weeklyReview(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const active = await db.select({ id: clients.id }).from(clients).where(eq(clients.status, "active"));
  for (const c of active) await enqueue("strategy.analyze", { clientId: c.id, mode: "weekly" }, { dedupeKey: `weekly:${c.id}:${new Date().toISOString().slice(0, 10)}` });
  return { clients: active.length };
}
