import { collectPostMetrics, dailyKpis } from "../pipeline/measurement";
import { syncCommunity } from "../pipeline/community";
import { housekeeping } from "../pipeline/housekeeping";
import { planScenarioJob } from "../pipeline/planning";
import { advanceProduction, startProduction } from "../pipeline/production";
import { publishDue, scheduleApproved } from "../pipeline/publishing";
import { reviseItem } from "../pipeline/revision";
import { runAnalysis, weeklyReview } from "../pipeline/strategy";
import { sweep } from "../pipeline/sweep";
import { dailyWatch } from "../pipeline/watch";

export interface JobContext {
  jobId: number;
  attempt: number;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<Record<string, unknown> | void>;

const handlers: Record<string, JobHandler> = {
  "scenario.plan": (p) => planScenarioJob(p as { scenarioId: string }),
  "content.produce": (p) => startProduction(p as { contentId: string }),
  "production.advance": () => advanceProduction(),
  "content.revise": (p) => reviseItem(p as { contentId: string }),
  "content.schedule": (p) => scheduleApproved(p as { contentId: string }),
  "publish.due": () => publishDue(),
  "metrics.posts": () => collectPostMetrics(),
  "metrics.daily": () => dailyKpis(),
  "strategy.analyze": (p) => runAnalysis(p as { clientId: string; mode?: "daily" | "weekly" }),
  "review.weekly": () => weeklyReview(),
  "community.sync": () => syncCommunity(),
  "watch.daily": () => dailyWatch(),
  "agent.sweep": () => sweep(),
  "system.housekeeping": () => housekeeping(),
};

export function getHandler(type: string): JobHandler | undefined {
  return handlers[type];
}

export function jobTypes(): string[] {
  return Object.keys(handlers);
}
