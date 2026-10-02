import { eq, lte, and } from "drizzle-orm";
import { nextRun } from "@/domain/cron";
import { config } from "../config";
import { getDb } from "../db/client";
import { schedules } from "../db/schema";
import { enqueue } from "./queue";

export interface ScheduleDef {
  name: string;
  cron: string;
  jobType: string;
  /** "agency" = AGENCY_TIMEZONE; per-client local times are handled inside the jobs. */
  timezone: "UTC" | "agency";
  description: string;
}

/**
 * The agent's rhythm. Matches the operating model of the Luxi skill: frequent sweeps,
 * a morning daily watch, and a Monday weekly review.
 */
export const DEFAULT_SCHEDULES: ScheduleDef[] = [
  { name: "publish-due", cron: "* * * * *", jobType: "publish.due", timezone: "UTC", description: "Publish posts whose time has come" },
  { name: "advance-production", cron: "* * * * *", jobType: "production.advance", timezone: "UTC", description: "Poll renders and assemble finished cuts" },
  { name: "sweep", cron: "*/10 * * * *", jobType: "agent.sweep", timezone: "UTC", description: "Plan new scenarios, revise, produce green-lit items" },
  { name: "community", cron: "*/10 * * * *", jobType: "community.sync", timezone: "UTC", description: "Read and answer comments and DMs" },
  { name: "post-metrics", cron: "20 * * * *", jobType: "metrics.posts", timezone: "UTC", description: "Collect 24h / 72h / 7d post metrics" },
  { name: "daily-kpis", cron: "30 6 * * *", jobType: "metrics.daily", timezone: "agency", description: "Account KPIs, goal pace, anomaly checks" },
  { name: "daily-watch", cron: "0 7 * * *", jobType: "watch.daily", timezone: "agency", description: "Check platform/tool changes, account health, credits; morning brief" },
  { name: "weekly-review", cron: "0 8 * * 1", jobType: "review.weekly", timezone: "agency", description: "Diagnose, pivot, evaluate experiments, weekly report" },
  { name: "housekeeping", cron: "40 3 * * *", jobType: "system.housekeeping", timezone: "UTC", description: "Prune old logs, expire OAuth states, refresh tokens" },
];

function tzFor(def: { timezone: string }): string {
  return def.timezone === "agency" ? config().agencyTimezone : def.timezone;
}

/** Insert missing schedules; keep the enabled flag the user may have changed. */
export async function ensureSchedules(now = new Date()): Promise<void> {
  const db = await getDb();
  for (const def of DEFAULT_SCHEDULES) {
    const tz = tzFor(def);
    await db
      .insert(schedules)
      .values({ name: def.name, cron: def.cron, timezone: tz, jobType: def.jobType, nextRunAt: nextRun(def.cron, now, tz) })
      .onConflictDoUpdate({
        target: schedules.name,
        set: { cron: def.cron, jobType: def.jobType, timezone: tz },
      });
  }
}

/** Enqueue every schedule that is due. Dedupe keys make this safe to run from several processes. */
export async function tickSchedules(now = new Date()): Promise<string[]> {
  const db = await getDb();
  const due = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)));
  const fired: string[] = [];
  for (const s of due) {
    const slot = s.nextRunAt ?? now;
    await enqueue(s.jobType, { schedule: s.name, slot: slot.toISOString() }, { dedupeKey: `${s.name}:${slot.toISOString()}`, maxAttempts: 3 });
    await db
      .update(schedules)
      .set({ lastRunAt: now, nextRunAt: nextRun(s.cron, now, s.timezone) })
      .where(eq(schedules.name, s.name));
    fired.push(s.name);
  }
  return fired;
}
