/**
 * npm run agent [-- <job.type> [jsonPayload]] — run one worker tick, or enqueue and run a single
 * job type (e.g. `npm run agent -- watch.daily`). Useful from cron on hosts without a long-running
 * process, and for trying a routine by hand.
 */
import { closeDb } from "../server/db/client";
import { enqueue } from "../server/jobs/queue";
import { jobTypes } from "../server/jobs/registry";
import { ensureSchedules } from "../server/jobs/scheduler";
import { runDueJobs, workerTick } from "../server/jobs/worker";

async function main() {
  const [type, payload] = process.argv.slice(2);
  await ensureSchedules();
  if (type) {
    if (!jobTypes().includes(type)) throw new Error(`Unknown job type "${type}". Known: ${jobTypes().join(", ")}`);
    await enqueue(type, payload ? (JSON.parse(payload) as Record<string, unknown>) : { manual: true }, { dedupeKey: `cli:${type}:${Date.now()}` });
    console.log(JSON.stringify(await runDueJobs(280_000)));
  } else {
    console.log(JSON.stringify(await workerTick(280_000)));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
