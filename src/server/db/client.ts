import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { config } from "../config";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

interface OpenDb {
  db: DB;
  kind: "postgres" | "pglite";
  close: () => Promise<void>;
}

interface DbHandle {
  ready: Promise<OpenDb>;
}

const globalForDb = globalThis as unknown as { __luxiDb?: DbHandle };

export function migrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

async function openPostgres(url: string): Promise<OpenDb> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema }) as unknown as DB;
  return { db, kind: "postgres", close: () => client.end({ timeout: 5 }) };
}

async function openPglite(dir: string | null): Promise<OpenDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const client = dir ? new PGlite(dir) : new PGlite();
  const db = drizzle(client, { schema }) as unknown as DB;
  return { db, kind: "pglite", close: () => client.close() };
}

async function migrate(handle: OpenDb): Promise<void> {
  const migrationsDir = migrationsFolder();
  if (handle.kind === "postgres") {
    const { migrate: run } = await import("drizzle-orm/postgres-js/migrator");
    // Serialise migrations across processes (web + worker) with an advisory lock.
    await handle.db.execute(sql`select pg_advisory_lock(727272)`);
    try {
      await run(handle.db as never, { migrationsFolder: migrationsDir });
    } finally {
      await handle.db.execute(sql`select pg_advisory_unlock(727272)`);
    }
  } else {
    const { migrate: run } = await import("drizzle-orm/pglite/migrator");
    await run(handle.db as never, { migrationsFolder: migrationsDir });
  }
}

function open(): DbHandle {
  const cfg = config();
  const ready = (cfg.db.url ? openPostgres(cfg.db.url) : openPglite(cfg.db.pgliteDir)).then(async (h) => {
    await migrate(h);
    return h;
  });
  return { ready };
}

/** Resolve once the connection is open and migrations have run. */
export async function getDb(): Promise<DB> {
  if (!globalForDb.__luxiDb) globalForDb.__luxiDb = open();
  try {
    return (await globalForDb.__luxiDb.ready).db;
  } catch (err) {
    // Allow a later call to retry (e.g. the database was briefly unreachable at boot).
    globalForDb.__luxiDb = undefined;
    throw err;
  }
}

export async function dbKind(): Promise<"postgres" | "pglite"> {
  await getDb();
  return (await globalForDb.__luxiDb!.ready).kind;
}

export async function closeDb(): Promise<void> {
  const h = globalForDb.__luxiDb;
  globalForDb.__luxiDb = undefined;
  if (!h) return;
  const opened = await h.ready.catch(() => undefined);
  await opened?.close();
}

/** Tests: an isolated in-memory PGlite database with migrations applied, installed as the global db. */
export async function useInMemoryDbForTests(): Promise<DB> {
  await closeDb();
  const opened = await openPglite(null);
  await migrate(opened);
  globalForDb.__luxiDb = { ready: Promise.resolve(opened) };
  return opened.db;
}

/** Normalise raw `db.execute` results across drivers (postgres-js returns an array, PGlite `{ rows }`). */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r.rows ?? [];
}
