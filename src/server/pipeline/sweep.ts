import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { contentItems, scenarios } from "../db/schema";
import { enqueue } from "../jobs/queue";

/**
 * The skill's "sweep": anything waiting on the agent gets a job. UI actions enqueue these jobs
 * immediately; the sweep is the safety net (missed triggers, restarts).
 */
export async function sweep(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const newScenarios = await db.select({ id: scenarios.id }).from(scenarios).where(eq(scenarios.status, "new"));
  for (const s of newScenarios) await enqueue("scenario.plan", { scenarioId: s.id }, { dedupeKey: `plan:${s.id}` });

  const items = await db
    .select({ id: contentItems.id, status: contentItems.status })
    .from(contentItems)
    .where(inArray(contentItems.status, ["greenlit", "revise", "approved"]));
  for (const i of items) {
    if (i.status === "greenlit") await enqueue("content.produce", { contentId: i.id }, { dedupeKey: `produce:${i.id}` });
    if (i.status === "revise") await enqueue("content.revise", { contentId: i.id }, { dedupeKey: `revise:${i.id}` });
    if (i.status === "approved") await enqueue("content.schedule", { contentId: i.id }, { dedupeKey: `schedule:${i.id}` });
  }
  return { scenarios: newScenarios.length, items: items.length };
}
