import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { alerts, inboxItems, jobs, kpiSnapshots, llmUsage, metricSnapshots, runs } from "../db/schema";
import { pruneOAuthStates } from "../platforms/oauth";

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Keep the desk small: read alerts 60 d, inbox 120 d, KPIs 400 d, runs 90 d, finished jobs 14 d. */
export async function housekeeping(): Promise<Record<string, unknown>> {
  const db = await getDb();
  await db.delete(alerts).where(and(eq(alerts.read, true), lt(alerts.createdAt, days(60))));
  await db.delete(inboxItems).where(lt(inboxItems.receivedAt, days(120)));
  await db.delete(kpiSnapshots).where(lt(kpiSnapshots.createdAt, days(400)));
  await db.delete(runs).where(lt(runs.startedAt, days(90)));
  await db.delete(metricSnapshots).where(lt(metricSnapshots.capturedAt, days(120)));
  await db.delete(llmUsage).where(lt(llmUsage.createdAt, days(400)));
  await db.delete(jobs).where(and(inArray(jobs.status, ["done", "dead"]), lt(jobs.createdAt, days(14))));
  await pruneOAuthStates();
  return { ok: true };
}
