import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { chatTurn } from "@/agent/chat";
import { currentUser } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { chatThreads } from "@/server/db/schema";
import { errorMessage, log } from "@/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { threadId?: string | null; text?: string } | null;
  const text = body?.text?.trim();
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  if (text.length > 8000) return NextResponse.json({ error: "Message too long" }, { status: 413 });
  let threadId = body?.threadId ?? null;
  if (threadId) {
    const db = await getDb();
    const [row] = await db.select({ id: chatThreads.id }).from(chatThreads).where(eq(chatThreads.id, threadId));
    if (!row) threadId = null;
  }
  try {
    return NextResponse.json(await chatTurn(threadId, text));
  } catch (err) {
    log.error("chat.failed", { error: errorMessage(err) });
    return NextResponse.json({ error: `The agent couldn't answer: ${errorMessage(err)}` }, { status: 500 });
  }
}
