/**
 * npm run worker — the agent's job loop as its own process (pair with RUN_WORKER=off on the web
 * app). Requires DATABASE_URL: the embedded PGlite database can only be opened by one process,
 * so without Postgres keep the default in-process worker instead.
 */
import { config } from "../server/config";
import { closeDb } from "../server/db/client";
import { startWorkerLoop } from "../server/jobs/worker";
import { log } from "../server/log";

if (!config().db.url) {
  console.error("The standalone worker needs DATABASE_URL (Postgres). With the embedded database, run the app with RUN_WORKER=in-process instead.");
  process.exit(1);
}

startWorkerLoop();

const stop = async (signal: string) => {
  log.info("worker.stopping", { signal });
  await closeDb().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
