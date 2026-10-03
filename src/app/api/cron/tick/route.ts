import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { safeEqual } from "@/server/crypto";
import { ensureSchedules } from "@/server/jobs/scheduler";
import { workerTick } from "@/server/jobs/worker";
import { errorMessage, log } from "@/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * External heartbeat for hosts that can't run a background worker (serverless, scale-to-zero).
 * Call every minute with `Authorization: Bearer $CRON_SECRET` (or ?secret=).
 */
async function tick(req: NextRequest) {
  const secret = config().worker.cronSecret;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  const q = req.nextUrl.searchParams.get("secret") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`) && !safeEqual(q, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const budgetMs = Math.min(280_000, Math.max(5_000, Number(req.nextUrl.searchParams.get("budgetMs")) || 50_000));
  try {
    await ensureSchedules();
    const result = await workerTick(budgetMs);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error("cron.tick_failed", { error: errorMessage(err) });
    return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 500 });
  }
}

export const GET = tick;
export const POST = tick;
