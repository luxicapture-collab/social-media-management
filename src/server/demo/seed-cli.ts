/**
 * npm run seed:demo — load sample clients, history and a scenario, then render the green-lit cut.
 * With the embedded database (no DATABASE_URL) stop the app first: PGlite allows one process.
 * The same data can be loaded from the Today screen in demo mode without stopping anything.
 */
import { closeDb } from "../db/client";
import { runDueJobs } from "../jobs/worker";
import { advanceProduction } from "../pipeline/production";
import { seedDemo } from "./seed";

async function main() {
  const r = await seedDemo({ log: (m) => console.log(`• ${m}`) });
  if (!r.seeded) {
    console.log("Clients already exist — nothing was seeded.");
    return;
  }
  console.log("• Rendering the green-lit concept with ffmpeg (about a minute)…");
  await runDueJobs(120_000);
  await advanceProduction();
  console.log(`Done. Sample clients: ${r.clientIds.join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
