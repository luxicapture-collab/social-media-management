import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { safeEqual, verifyMetaSignature } from "@/server/crypto";
import { enqueue } from "@/server/jobs/queue";
import { errorMessage, log } from "@/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta webhook verification handshake (hub.challenge). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = config().meta.webhookVerifyToken;
  if (token && sp.get("hub.mode") === "subscribe" && safeEqual(sp.get("hub.verify_token") ?? "", token)) {
    return new Response(sp.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Comment, mention and message events from Instagram / Facebook Pages. The signature is checked
 * against the app secret, then a community sync is queued so replies go out within seconds
 * instead of waiting for the 10-minute poll.
 */
export async function POST(req: NextRequest) {
  const secret = config().meta.appSecret;
  if (!secret) return new Response("Not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) return new Response("Bad signature", { status: 401 });
  try {
    const body = JSON.parse(raw) as { object?: string; entry?: unknown[] };
    await enqueue("community.sync", { source: "meta-webhook", object: body.object ?? null }, { dedupeKey: `webhook:community:${Math.floor(Date.now() / 15_000)}` });
    log.info("webhook.meta", { object: body.object, entries: body.entry?.length ?? 0 });
  } catch (err) {
    log.warn("webhook.meta_failed", { error: errorMessage(err) });
  }
  return NextResponse.json({ ok: true });
}
