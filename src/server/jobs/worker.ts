import os from "node:os";
import { config } from "../config";
import { errorMessage, log } from "../log";
import { claimNext, completeJob, failJob, reapStaleJobs } from "./queue";
import { getHandler } from "./registry";
import { ensureSchedules, tickSchedules } from "./scheduler";

const workerId = `${os.hostname()}:${process.pid}`;

export interface RunResult {
  ran: number;
  failed: number;
  fired: string[];
}

/** Run due jobs until the queue is empty or the time budget is spent. */
export async function runDueJobs(budgetMs = 50_000): Promise<{ ran: number; failed: number }> {
  const started = Date.now();
  let ran = 0;
  let failed = 0;
  while (Date.now() - started < budgetMs) {
    const job = await claimNext(workerId);
    if (!job) break;
    const handler = getHandler(job.type);
    if (!handler) {
      await failJob(job, new Error(`No handler registered for job type "${job.type}"`));
      failed++;
      continue;
    }
    try {
      const result = await handler(job.payload ?? {}, { jobId: job.id, attempt: job.attempts });
      await completeJob(job.id, result ?? undefined);
      ran++;
    } catch (err) {
      failed++;
      if ((err as Error)?.name !== "RescheduleJob") log.warn("job.error", { id: job.id, type: job.type, error: errorMessage(err) });
      await failJob(job, err);
    }
  }
  return { ran, failed };
}

/** One worker tick: fire schedules, recover stuck jobs, run what's due. */
export async function workerTick(budgetMs = 50_000): Promise<RunResult> {
  const fired = await tickSchedules();
  await reapStaleJobs(30);
  const r = await runDueJobs(budgetMs);
  return { ...r, fired };
}

let started = false;
let inFlight = false;

/** Start the background loop inside the current process (Next.js server or standalone worker). */
export function startWorkerLoop(): void {
  if (started) return;
  started = true;
  const tickMs = config().worker.tickSeconds * 1000;
  const loop = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await workerTick(Math.max(10_000, tickMs * 3));
    } catch (err) {
      log.error("worker.tick_failed", { error: errorMessage(err) });
    } finally {
      inFlight = false;
    }
  };
  ensureSchedules()
    .then(() => {
      log.info("worker.started", { workerId, tickSeconds: config().worker.tickSeconds, demo: config().demo });
      void loop();
      setInterval(loop, tickMs).unref?.();
    })
    .catch((err) => {
      started = false;
      log.error("worker.start_failed", { error: errorMessage(err) });
    });
}
