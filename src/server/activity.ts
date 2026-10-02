import { desc } from "drizzle-orm";
import type { AlertImportance, AlertKind } from "@/domain/types";
import { newId } from "./crypto";
import { getDb } from "./db/client";
import { alerts, runs } from "./db/schema";
import { log } from "./log";

/** Append to the agent activity log (the Today screen's feed). */
export async function logRun(input: {
  kind: string;
  summary: string;
  clientId?: string | null;
  ok?: boolean;
  details?: Record<string, unknown>;
  costUsd?: number;
  startedAt?: Date;
}): Promise<void> {
  const db = await getDb();
  await db.insert(runs).values({
    id: newId("run"),
    kind: input.kind,
    summary: input.summary.slice(0, 2000),
    clientId: input.clientId ?? null,
    ok: input.ok ?? true,
    details: input.details ?? {},
    costUsd: input.costUsd ?? 0,
    startedAt: input.startedAt ?? new Date(),
    finishedAt: new Date(),
  });
  log.info("run", { kind: input.kind, ok: input.ok ?? true, summary: input.summary.slice(0, 200) });
}

export interface AlertInput {
  kind: AlertKind;
  source: string;
  title: string;
  summary: string;
  importance: AlertImportance;
  action?: string;
  url?: string;
  clientId?: string | null;
  /** Same key = same alert; it is not repeated. */
  dedupeKey?: string;
}

/** Create an alert unless one with the same dedupe key exists. Returns true when a new alert was written. */
export async function raiseAlert(input: AlertInput): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .insert(alerts)
    .values({
      id: newId("alr"),
      kind: input.kind,
      source: input.source,
      title: input.title.slice(0, 300),
      summary: input.summary.slice(0, 2000),
      importance: input.importance,
      action: input.action ?? null,
      url: input.url ?? null,
      clientId: input.clientId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: alerts.id });
  if (rows.length) {
    // Imported lazily to avoid a cycle (notify → settings → db).
    const { notify } = await import("./notify");
    await notify({
      title: input.title,
      body: input.summary,
      url: "/alerts",
      importance: input.importance,
      tag: input.dedupeKey ?? undefined,
    }).catch((err) => log.warn("alert.notify_failed", { error: String(err) }));
  }
  return rows.length > 0;
}

export async function recentRuns(limit = 30) {
  const db = await getDb();
  return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
}
