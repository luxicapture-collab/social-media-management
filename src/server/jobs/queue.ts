import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, rowsOf } from "../db/client";
import { jobs, type JobRow } from "../db/schema";
import { log } from "../log";

/** Throw to stop retrying a job (bad input, missing connection, policy refusal...). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Throw to retry later without counting as a failure (e.g. a generation still rendering). */
export class RescheduleJob extends Error {
  constructor(readonly delayMs: number, message = "rescheduled") {
    super(message);
    this.name = "RescheduleJob";
  }
}

export interface EnqueueOptions {
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}

export async function enqueue(type: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}): Promise<number | null> {
  const db = await getDb();
  const rows = await db
    .insert(jobs)
    .values({
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

export async function claimNext(workerId: string): Promise<JobRow | null> {
  const db = await getDb();
  const result = await db.execute(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
    where id = (
      select id from jobs
      where status = 'queued' and run_at <= now()
      order by run_at, id
      for update skip locked
      limit 1
    )
    returning id`);
  const claimed = rowsOf<{ id: number | string }>(result)[0];
  if (!claimed) return null;
  const [row] = await db.select().from(jobs).where(eq(jobs.id, Number(claimed.id)));
  return row ?? null;
}

export async function completeJob(id: number, result?: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db
    .update(jobs)
    .set({ status: "done", result: result ?? null, finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
    .where(eq(jobs.id, id));
}

/** Exponential backoff: 30s, 2m, 8m, 32m, ~2h. */
export function backoffMs(attempt: number): number {
  return Math.min(2 * 3_600_000, 30_000 * 4 ** Math.max(0, attempt - 1));
}

export async function failJob(job: JobRow, error: unknown): Promise<void> {
  const db = await getDb();
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RescheduleJob) {
    await db
      .update(jobs)
      .set({
        status: "queued",
        runAt: new Date(Date.now() + error.delayMs),
        attempts: Math.max(0, job.attempts - 1),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      })
      .where(eq(jobs.id, job.id));
    return;
  }
  const permanent = error instanceof PermanentJobError;
  const dead = permanent || job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      runAt: dead ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
      lastError: message.slice(0, 4000),
      lockedAt: null,
      lockedBy: null,
      finishedAt: dead ? new Date() : null,
    })
    .where(eq(jobs.id, job.id));
  if (dead) log.warn("job.dead", { id: job.id, type: job.type, error: message });
}

/** Return jobs stuck in `running` (crashed worker) to the queue. */
export async function reapStaleJobs(olderThanMinutes = 30): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const rows = await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, lastError: "reaped after worker timeout" })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
}

export async function pendingJobCount(types?: string[]): Promise<number> {
  const db = await getDb();
  const where = types?.length ? and(eq(jobs.status, "queued"), inArray(jobs.type, types)) : eq(jobs.status, "queued");
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(where);
  return Number(rows[0]?.n ?? 0);
}
