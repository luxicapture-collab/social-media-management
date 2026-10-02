import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { extractHashtags, xWeightedLength } from "@/domain/captions";
import { normalizeScheduledAt } from "@/domain/scheduling";
import type { Platform } from "@/domain/types";
import { logRun, raiseAlert } from "../activity";
import { config } from "../config";
import { decryptOptional, newId } from "../crypto";
import { getDb } from "../db/client";
import { assets, clients, contentItems, publications, type ContentRow, type PublicationRow } from "../db/schema";
import { PermanentJobError } from "../jobs/queue";
import { errorMessage } from "../log";
import { localMediaPath } from "../media/storage";
import { notify } from "../notify";
import { metricoolSchedule } from "../platforms/metricool";
import { adapterFor } from "../platforms/registry";
import { PlatformError, type PublishMedia, type PublishRequest } from "../platforms/types";
import { freshCtx, getConnection, recordConnectionFailure } from "../services/connections";
import { existingSchedule } from "./planning";

/** Insert the AI disclosure line before the trailing hashtag block (or at the end). */
export function withDisclosure(caption: string, disclosure: string, platform: Platform): string {
  const line = disclosure.trim();
  if (!line || !caption.trim() || caption.includes(line)) return caption;
  const lines = caption.trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  const tagsOnly = extractHashtags(last).length > 0 && last.replace(/#[\p{L}\p{N}_]+/gu, "").trim() === "";
  const next = tagsOnly ? [...lines.slice(0, -1), line, last].join("\n") : `${caption.trimEnd()}\n\n${line}`;
  if (platform === "x" && xWeightedLength(next) > 280) return caption;
  return next;
}

/** Pick the media variant for a platform from the content's deliverables. */
export function mediaForPlatform(item: Pick<ContentRow, "media" | "format">, platform: Platform): ContentRow["media"] {
  const media = item.media ?? [];
  if (platform === "linkedin" && item.format === "carousel") {
    const pdf = media.filter((m) => m.kind === "pdf");
    if (pdf.length) return pdf;
  }
  const videos = media.filter((m) => m.kind === "video");
  if (videos.length) {
    const exact = videos.find((m) => m.platform === platform);
    return [exact ?? videos.find((m) => !m.platform) ?? videos[0]];
  }
  const images = media.filter((m) => m.kind === "image");
  if (platform === "x") return images.slice(0, 4);
  if (item.format === "story") return images.slice(0, 1);
  return images;
}

function aiGenerated(item: ContentRow): boolean {
  return Boolean(item.production && (item.production.shots.some((s) => s.kind !== "title") || item.production.frames.length || item.production.voiceover));
}

/** approved → scheduled: one publication per platform, each with its own caption. */
export async function scheduleApproved(payload: { contentId: string }): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, payload.contentId));
  if (!item) throw new PermanentJobError(`Content ${payload.contentId} not found`);
  if (item.status !== "approved") return { skipped: `status is ${item.status}` };
  const [client] = await db.select().from(clients).where(eq(clients.id, item.clientId));
  const tz = client.timezone;
  const now = new Date();
  const notes: string[] = [];
  const created: string[] = [];
  const schedule = (await existingSchedule(item.clientId)).filter((e) => !item.scheduledAt || e.at.getTime() !== item.scheduledAt.getTime());

  for (const platform of item.platforms) {
    const conn = await getConnection(item.clientId, platform);
    if (!conn) {
      notes.push(`${platform} isn't connected — skipped.`);
      continue;
    }
    const { at, note } = normalizeScheduledAt(item.scheduledAt, { platform, format: item.format, tz, now, existing: schedule, minLeadMinutes: 10 });
    if (!at) {
      notes.push(`No legal slot for ${platform} in the next two weeks.`);
      continue;
    }
    if (note) notes.push(`${platform}: ${note}`);
    schedule.push({ at, platform, format: item.format });
    const route = conn.route;
    const caption =
      item.format === "story"
        ? ""
        : route === "direct" && aiGenerated(item)
          ? withDisclosure(item.captions[platform] ?? "", client.autonomy.aiDisclosureText ?? "", platform)
          : (item.captions[platform] ?? "");
    const manual = route === "direct" && item.format === "story" && item.storyFrames.some((f) => f.sticker?.trim());
    const media = mediaForPlatform(item, platform);
    const pubId = newId("pub");
    await db
      .insert(publications)
      .values({
        id: pubId,
        contentId: item.id,
        clientId: item.clientId,
        platform,
        status: "scheduled",
        scheduledAt: at,
        caption,
        firstComment: item.firstComments[platform] || null,
        mediaUrl: media[0]?.url ?? null,
        route,
        manual,
      })
      .onConflictDoUpdate({
        target: [publications.contentId, publications.platform],
        set: { status: "scheduled", scheduledAt: at, caption, route, manual, attempts: 0, lastError: null, updatedAt: new Date() },
      });
    const [pub] = await db.select().from(publications).where(and(eq(publications.contentId, item.id), eq(publications.platform, platform)));

    if (route === "metricool") {
      try {
        const mc = await getConnection(item.clientId, "metricool");
        const token = decryptOptional(mc?.accessTokenEnc) ?? config().metricool.userToken;
        const userId = (mc?.meta?.userId as string | undefined) ?? config().metricool.userId;
        if (!mc || !token || !userId) throw new PermanentJobError("Metricool route selected but no Metricool brand/token is configured");
        const result = await metricoolSchedule({ userToken: token, userId, blogId: mc.accountId }, await buildRequest(item, pub, tz));
        await db.update(publications).set({ externalId: result.externalId, lastError: result.note ?? null, updatedAt: new Date() }).where(eq(publications.id, pub.id));
      } catch (err) {
        await db.update(publications).set({ status: "failed", lastError: errorMessage(err).slice(0, 1000), updatedAt: new Date() }).where(eq(publications.id, pub.id));
        notes.push(`${platform}: Metricool rejected the post — ${errorMessage(err)}`);
        await raiseAlert({ kind: "publish", source: "metricool", title: `Metricool rejected ${platform} post`, summary: `"${item.title}": ${errorMessage(err).slice(0, 300)}`, importance: "medium", url: `/content/${item.id}`, clientId: item.clientId, dedupeKey: `mc:${pub.id}` });
        continue;
      }
    }
    created.push(platform);
  }

  if (!created.length) {
    await db.update(contentItems).set({ agentNote: [`Nothing scheduled.`, ...notes].join(" "), updatedAt: new Date() }).where(eq(contentItems.id, item.id));
    await raiseAlert({ kind: "publish", source: "scheduler", title: `Couldn't schedule "${item.title}"`, summary: notes.join(" ").slice(0, 600) || "No connected platforms for this content.", action: "Connect the platform(s) on the client page, then approve again.", importance: "high", url: `/content/${item.id}`, clientId: item.clientId, dedupeKey: `nosched:${item.id}` });
    return { scheduled: 0 };
  }
  const pubs = await db.select().from(publications).where(eq(publications.contentId, item.id));
  const first = pubs.filter((p) => p.status === "scheduled").sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  await db
    .update(contentItems)
    .set({ status: "scheduled", scheduledAt: first?.scheduledAt ?? item.scheduledAt, agentNote: notes.join(" ") || item.agentNote, updatedAt: new Date() })
    .where(eq(contentItems.id, item.id));
  await logRun({ kind: "schedule", clientId: item.clientId, summary: `Scheduled "${item.title}" on ${created.join(", ")}.`, details: { contentId: item.id, notes } });
  return { scheduled: created.length };
}

async function buildRequest(item: ContentRow, pub: PublicationRow, tz: string): Promise<PublishRequest> {
  const db = await getDb();
  const chosen = mediaForPlatform(item, pub.platform);
  const assetRows = chosen.length ? await db.select().from(assets).where(inArray(assets.id, chosen.map((m) => m.assetId))) : [];
  const byId = new Map(assetRows.map((a) => [a.id, a]));
  const media: PublishMedia[] = chosen.map((m) => {
    const a = byId.get(m.assetId);
    return {
      kind: m.kind,
      url: m.url,
      localPath: a && config().storage.driver === "local" ? localMediaPath(a.storageKey) : undefined,
      mime: a?.mime ?? (m.kind === "video" ? "video/mp4" : m.kind === "pdf" ? "application/pdf" : "image/jpeg"),
      coverUrl: m.coverUrl,
      coverAtMs: item.production ? Math.round((item.production.coverAtSec || 0.5) * 1000) : undefined,
      altText: item.title,
      bytes: a?.bytes ?? undefined,
    };
  });
  return {
    platform: pub.platform,
    format: item.format,
    caption: pub.caption,
    media,
    firstComment: pub.firstComment ?? undefined,
    trialReel: item.trialReel && pub.platform === "instagram",
    aiGenerated: aiGenerated(item),
    title: item.title,
    scheduledAt: pub.scheduledAt,
    timezone: tz,
    needsManualFinish: pub.manual,
  };
}

async function refreshContentStatus(contentId: string): Promise<void> {
  const db = await getDb();
  const pubs = await db.select().from(publications).where(eq(publications.contentId, contentId));
  if (!pubs.length) return;
  const open = pubs.some((p) => ["pending", "scheduled", "publishing"].includes(p.status));
  const anyPublished = pubs.some((p) => p.status === "published");
  if (!open && anyPublished) await db.update(contentItems).set({ status: "live", updatedAt: new Date() }).where(and(eq(contentItems.id, contentId), ne(contentItems.status, "analyzed")));
  else if (!open && !anyPublished) await db.update(contentItems).set({ status: "failed", updatedAt: new Date() }).where(eq(contentItems.id, contentId));
}

/** Cron (every minute): publish what is due. */
export async function publishDue(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const due = await db
    .select()
    .from(publications)
    .where(and(eq(publications.status, "scheduled"), lte(publications.scheduledAt, new Date())))
    .limit(20);
  let published = 0;
  let failed = 0;
  for (const pub of due) {
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, pub.contentId));
    if (!item || item.status === "dropped") {
      await db.update(publications).set({ status: "canceled", updatedAt: new Date() }).where(eq(publications.id, pub.id));
      continue;
    }
    if (pub.route === "metricool") {
      // Metricool publishes it; measurement matches the native post afterwards.
      await db.update(publications).set({ status: "published", publishedAt: pub.scheduledAt, updatedAt: new Date() }).where(eq(publications.id, pub.id));
      await refreshContentStatus(item.id);
      published++;
      continue;
    }
    if (pub.manual) {
      if (!pub.checkpoints.manualNotified) {
        await notify({ title: `Time to post a story: ${item.title}`, body: "It needs an interactive sticker, so post it from your phone. Tap to open the frames.", url: `/content/${item.id}`, importance: "high", urgent: true });
        await db.update(publications).set({ checkpoints: { ...pub.checkpoints, manualNotified: new Date().toISOString() }, updatedAt: new Date() }).where(eq(publications.id, pub.id));
      }
      continue;
    }
    const conn = await getConnection(item.clientId, pub.platform);
    const [client] = await db.select().from(clients).where(eq(clients.id, item.clientId));
    await db.update(publications).set({ status: "publishing", attempts: pub.attempts + 1, updatedAt: new Date() }).where(eq(publications.id, pub.id));
    try {
      if (!conn) throw new PlatformError(`${pub.platform} is not connected`, { retryable: false });
      const ctx = await freshCtx(conn);
      const result = await adapterFor(pub.platform, ctx).publish(ctx, await buildRequest(item, pub, client.timezone));
      await db
        .update(publications)
        .set({ status: "published", externalId: result.externalId, permalink: result.permalink ?? null, publishedAt: result.publishedAt, lastError: result.note ?? null, updatedAt: new Date() })
        .where(eq(publications.id, pub.id));
      published++;
      await logRun({ kind: "publish", clientId: item.clientId, summary: `Published "${item.title}" on ${pub.platform}.`, details: { publicationId: pub.id, permalink: result.permalink } });
    } catch (err) {
      failed++;
      const retryable = err instanceof PlatformError ? err.opts.retryable : true;
      if (conn && err instanceof PlatformError && err.opts.authExpired) await recordConnectionFailure(conn, err);
      if (retryable && pub.attempts + 1 < 3) {
        await db
          .update(publications)
          .set({ status: "scheduled", scheduledAt: new Date(Date.now() + 5 * 60_000 * (pub.attempts + 1)), lastError: errorMessage(err).slice(0, 1000), updatedAt: new Date() })
          .where(eq(publications.id, pub.id));
      } else {
        await db.update(publications).set({ status: "failed", lastError: errorMessage(err).slice(0, 1000), updatedAt: new Date() }).where(eq(publications.id, pub.id));
        await db.update(contentItems).set({ agentNote: `${pub.platform} publish failed: ${errorMessage(err).slice(0, 400)}`, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
        await raiseAlert({ kind: "publish", source: pub.platform, title: `Failed to publish "${item.title}" on ${pub.platform}`, summary: errorMessage(err).slice(0, 400), action: "Open the item: fix and re-approve, or publish by hand.", importance: "high", url: `/content/${item.id}`, clientId: item.clientId, dedupeKey: `pubfail:${pub.id}` });
      }
    }
    await refreshContentStatus(item.id);
  }
  return { due: due.length, published, failed };
}

/** The owner posted a sticker story by hand. */
export async function markManualPublished(publicationId: string, permalink?: string): Promise<void> {
  const db = await getDb();
  const [pub] = await db.select().from(publications).where(eq(publications.id, publicationId));
  if (!pub) return;
  await db.update(publications).set({ status: "published", publishedAt: new Date(), permalink: permalink ?? null, updatedAt: new Date() }).where(eq(publications.id, publicationId));
  await refreshContentStatus(pub.contentId);
}
