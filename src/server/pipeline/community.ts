import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { triageMessage } from "@/agent/community";
import { getLLM } from "@/agent/llm";
import type { Format, Platform } from "@/domain/types";
import { logRun, raiseAlert } from "../activity";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { clients, connections, contentItems, inboxItems, publications, type InboxRow } from "../db/schema";
import { getKnowledge } from "../knowledge";
import { errorMessage, log } from "../log";
import { adapterFor } from "../platforms/registry";
import { PlatformError, type PostRef } from "../platforms/types";
import { freshCtx, recordConnectionFailure } from "../services/connections";
import { buildClientContext } from "./context";

/** Minimum minutes between inbox reads per platform (X bills per post read). */
const MIN_INTERVAL_MIN: Record<Platform, number> = { instagram: 5, facebook: 5, linkedin: 15, x: 30 };
const DM_WINDOW_MS = 24 * 3_600_000;

export async function syncCommunity(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const activeClients = await db.select().from(clients).where(eq(clients.status, "active"));
  let fetched = 0;
  let acted = 0;
  for (const client of activeClients) {
    if (client.autonomy.replies === "off") continue;
    const conns = await db.select().from(connections).where(and(eq(connections.clientId, client.id), inArray(connections.status, ["connected", "error"])));
    for (const conn of conns) {
      if (conn.platform === "metricool") continue;
      const platform = conn.platform as Platform;
      const last = conn.meta.lastInboxSyncAt ? new Date(String(conn.meta.lastInboxSyncAt)) : new Date(Date.now() - 3 * 86_400_000);
      if (Date.now() - last.getTime() < MIN_INTERVAL_MIN[platform] * 60_000) continue;
      try {
        const ctx = await freshCtx(conn);
        const since14 = new Date(Date.now() - 14 * 86_400_000);
        const recent = await db
          .select({ externalId: publications.externalId, publishedAt: publications.publishedAt, format: contentItems.format })
          .from(publications)
          .innerJoin(contentItems, eq(publications.contentId, contentItems.id))
          .where(and(eq(publications.clientId, client.id), eq(publications.platform, platform), eq(publications.status, "published"), gte(publications.publishedAt, since14)));
        const refs: PostRef[] = recent
          .filter((r) => r.externalId && !r.externalId.startsWith("metricool:"))
          .map((r) => ({ externalId: r.externalId!, publishedAt: r.publishedAt!, format: r.format as Format }));
        const startedAt = new Date();
        const messages = await adapterFor(platform, ctx).listInbox(ctx, last, refs);
        fetched += messages.length;
        for (const m of messages) {
          const inserted = await db
            .insert(inboxItems)
            .values({
              id: newId("inb"),
              clientId: client.id,
              platform,
              kind: m.kind,
              externalId: m.externalId,
              threadId: m.threadId ?? null,
              parentExternalId: m.parentExternalId ?? null,
              postExternalId: m.postExternalId ?? null,
              authorName: m.authorName ?? null,
              authorHandle: m.authorHandle ?? null,
              authorId: m.authorId ?? null,
              text: m.text,
              receivedAt: m.receivedAt,
              permalink: m.permalink ?? null,
              raw: m.raw ?? {},
            })
            .onConflictDoNothing()
            .returning();
          if (inserted[0]) {
            await handleInboxItem(inserted[0]);
            acted++;
          }
        }
        await db
          .update(connections)
          .set({ meta: { ...conn.meta, lastInboxSyncAt: startedAt.toISOString() }, updatedAt: new Date() })
          .where(eq(connections.id, conn.id));
      } catch (err) {
        log.warn("community.sync_failed", { client: client.id, platform, error: errorMessage(err) });
        if (err instanceof PlatformError && err.opts.authExpired) await recordConnectionFailure(conn, err);
      }
    }
  }
  if (fetched) await logRun({ kind: "community", summary: `Community: ${fetched} new comments/DMs, ${acted} handled.` });
  return { fetched, acted };
}

/** Triage one message and act according to the client's reply policy. */
export async function handleInboxItem(item: InboxRow): Promise<void> {
  const db = await getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, item.clientId));
  const ctx = await buildClientContext(item.clientId);
  const pub = item.postExternalId
    ? (await db.select({ caption: publications.caption, contentId: publications.contentId }).from(publications).where(eq(publications.externalId, item.postExternalId)).limit(1))[0]
    : undefined;
  const title = pub ? (await db.select({ title: contentItems.title }).from(contentItems).where(eq(contentItems.id, pub.contentId)))[0]?.title : undefined;
  const thread = item.threadId
    ? (await db.select().from(inboxItems).where(and(eq(inboxItems.threadId, item.threadId), eq(inboxItems.clientId, item.clientId))).orderBy(desc(inboxItems.receivedAt)).limit(6))
        .reverse()
        .filter((t) => t.id !== item.id)
        .flatMap((t) => [{ from: "them" as const, text: t.text }, ...(t.reply ? [{ from: "us" as const, text: t.reply }] : [])])
    : [];

  const triage = await triageMessage(getLLM(), {
    ctx,
    playbook: await getKnowledge("community"),
    item: { platform: item.platform, kind: item.kind, authorName: item.authorName, text: item.text, postTitle: title, postCaption: pub?.caption, thread },
  });

  const base = { category: triage.category, language: triage.language, postTitle: title ?? null, updatedAt: new Date() };
  const policy = client.autonomy.replies;
  const dmExpired = item.kind === "dm" && Date.now() - item.receivedAt.getTime() > DM_WINDOW_MS;

  if (triage.action === "ignore") {
    await db.update(inboxItems).set({ ...base, status: "skipped", agentNote: "Nothing worth answering." }).where(eq(inboxItems.id, item.id));
    return;
  }
  if (triage.action === "hide") {
    if (policy === "auto") {
      const done = await act(item, "hide");
      await db.update(inboxItems).set({ ...base, status: done.ok ? "hidden" : "failed", agentNote: done.ok ? "Hidden as spam/abuse." : done.error }).where(eq(inboxItems.id, item.id));
    } else {
      await db.update(inboxItems).set({ ...base, status: "drafted", agentNote: "Suggest hiding (spam/abuse)." }).where(eq(inboxItems.id, item.id));
    }
    return;
  }

  // Escalations get a holding reply; leads (price, availability, booking) get a normal reply that
  // never quotes, and both come to the owner — a lead is revenue and needs a personal follow-up.
  const escalate = triage.action === "escalate";
  const lead = !escalate && triage.category === "lead";
  const needsYou = escalate || lead;
  const reason = escalate ? triage.needsYouReason : "Lead: a price or booking question. The agent replied without quoting — follow up with the details.";
  if (policy === "auto" && !dmExpired && triage.reply.trim()) {
    const done = await act(item, "reply", triage.reply);
    await db
      .update(inboxItems)
      .set({
        ...base,
        status: done.ok ? (needsYou ? "needs_you" : "sent") : "failed",
        reply: triage.reply,
        replyExternalId: done.externalId ?? null,
        repliedAt: done.ok ? new Date() : null,
        agentNote: done.ok ? (escalate ? `Holding reply sent. ${reason}` : lead ? reason : null) : done.error,
      })
      .where(eq(inboxItems.id, item.id));
  } else {
    await db
      .update(inboxItems)
      .set({ ...base, status: needsYou ? "needs_you" : "drafted", reply: triage.reply, agentNote: dmExpired ? "The 24-hour messaging window has closed; reply from the app if needed." : needsYou ? reason : null })
      .where(eq(inboxItems.id, item.id));
  }
  if (needsYou) {
    await raiseAlert({
      kind: "community",
      source: item.platform,
      title: lead ? `${client.name}: a lead to follow up` : `${client.name}: a ${item.kind} needs you`,
      summary: `${item.authorName ?? "Someone"}: "${item.text.slice(0, 160)}" — ${reason}`,
      action: "Open the inbox to follow up personally.",
      importance: lead ? "medium" : "high",
      url: "/inbox",
      clientId: client.id,
      dedupeKey: `inbox:${item.id}`,
    });
  }
}

async function act(item: InboxRow, action: "reply" | "hide", text?: string): Promise<{ ok: boolean; externalId?: string; error?: string }> {
  const db = await getDb();
  const [conn] = await db.select().from(connections).where(and(eq(connections.clientId, item.clientId), eq(connections.platform, item.platform)));
  if (!conn) return { ok: false, error: "Not connected" };
  try {
    const ctx = await freshCtx(conn);
    const adapter = adapterFor(item.platform, ctx);
    const target = { kind: item.kind, externalId: item.externalId, threadId: item.parentExternalId ?? item.threadId, authorId: item.authorId, postExternalId: item.postExternalId };
    if (action === "hide") {
      if (!adapter.hide) return { ok: false, error: `${item.platform} doesn't support hiding` };
      await adapter.hide(ctx, target);
      return { ok: true };
    }
    const r = await adapter.reply(ctx, target, text ?? "");
    return { ok: true, externalId: r.externalId };
  } catch (err) {
    if (err instanceof PlatformError && err.opts.authExpired) await recordConnectionFailure(conn, err);
    return { ok: false, error: errorMessage(err).slice(0, 500) };
  }
}

/** Send (or edit-and-send) a reply from the inbox UI. */
export async function sendInboxReply(inboxId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
  if (!item) return { ok: false, error: "Not found" };
  const done = await act(item, "reply", text);
  await db
    .update(inboxItems)
    .set(
      done.ok
        ? { status: "sent", reply: text, replyExternalId: done.externalId ?? null, repliedAt: new Date(), agentNote: null, updatedAt: new Date() }
        : { status: "failed", agentNote: done.error ?? "Send failed", updatedAt: new Date() },
    )
    .where(eq(inboxItems.id, inboxId));
  return done;
}

export async function hideInboxItem(inboxId: string): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
  if (!item) return { ok: false, error: "Not found" };
  const done = await act(item, "hide");
  await db.update(inboxItems).set({ status: done.ok ? "hidden" : "failed", agentNote: done.error ?? null, updatedAt: new Date() }).where(eq(inboxItems.id, inboxId));
  return done;
}
