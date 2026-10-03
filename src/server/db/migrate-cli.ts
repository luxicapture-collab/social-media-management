/** npm run db:migrate — open the database (Postgres or embedded PGlite) and apply migrations. */
import { closeDb, dbKind } from "./client";

dbKind()
  .then((kind) => console.log(`Migrations applied (${kind}).`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
