/**
 * Starts the job worker inside the Next.js server process (RUN_WORKER=in-process, the default),
 * so a single `npm start` runs the whole agent. Set RUN_WORKER=off when a separate
 * `npm run worker` process or the /api/cron/tick heartbeat drives the queue instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if ((process.env.RUN_WORKER ?? "in-process") !== "in-process") return;
  const { startWorkerLoop } = await import("./server/jobs/worker");
  startWorkerLoop();
}
