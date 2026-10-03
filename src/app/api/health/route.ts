import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { dbKind, getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Liveness + database check for uptime monitors and container health checks. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: await dbKind(), demo: config().demo, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
