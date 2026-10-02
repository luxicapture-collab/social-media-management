import type { Platform } from "@/domain/types";
import { localDateTimeString } from "@/domain/time";
import { httpError, platformFetch, readJson } from "./http";
import type { PublishRequest, PublishResult } from "./types";

/**
 * Metricool publishing route (POST https://app.metricool.com/api/v2/scheduler/posts with the
 * X-Mc-Auth user token, userId and blogId). Useful when a platform's own API approval isn't in
 * place yet (LinkedIn Community Management API access in particular): Metricool's approved apps
 * publish on our behalf, with native AI labels. One Metricool post per platform so each keeps its
 * own caption. Analytics and comments still come from direct connections.
 */

const NETWORK: Record<Platform, string> = { instagram: "instagram", facebook: "facebook", linkedin: "linkedin", x: "twitter" };

export function metricoolBody(req: PublishRequest): Record<string, unknown> {
  const media = req.media.filter((m) => m.kind !== "pdf").map((m) => m.url);
  const video = req.media.find((m) => m.kind === "video");
  const body: Record<string, unknown> = {
    autoPublish: !req.needsManualFinish,
    descendants: [],
    draft: false,
    firstCommentText: req.firstComment ?? "",
    hasNotReadNotes: false,
    media,
    mediaAltText: req.media.filter((m) => m.kind !== "pdf").map((m) => m.altText ?? ""),
    providers: [{ network: NETWORK[req.platform] }],
    publicationDate: { dateTime: localDateTimeString(req.scheduledAt, req.timezone), timezone: req.timezone },
    shortener: false,
    smartLinkData: { ids: [] },
    text: req.format === "story" ? "" : req.caption,
  };
  if (video && video.coverAtMs !== undefined && req.format !== "story") body.videoCoverMilliseconds = video.coverAtMs;
  if (req.platform === "instagram") {
    const type = req.format === "story" ? "STORY" : req.format === "reel" ? (req.trialReel ? "TRIAL_REEL" : "REEL") : "POST";
    body.instagramData = { type, isAiGenerated: req.aiGenerated, showReelOnFeed: !req.trialReel, collaborators: [] };
  } else if (req.platform === "facebook") {
    body.facebookData = { type: req.format === "story" ? "STORY" : req.format === "reel" ? "REEL" : "POST", ...(req.title && video ? { title: req.title } : {}) };
  } else if (req.platform === "linkedin") {
    const asDocument = req.format === "carousel";
    body.linkedinData = { type: "post", previewIncluded: true, publishImagesAsPDF: asDocument, ...(asDocument ? { documentTitle: (req.title ?? "Carousel").slice(0, 100) } : {}) };
  } else {
    body.twitterData = { tags: [] };
  }
  return body;
}

export async function metricoolSchedule(
  creds: { userToken: string; userId: string; blogId: string },
  req: PublishRequest,
): Promise<PublishResult> {
  const qs = new URLSearchParams({ userId: creds.userId, blogId: creds.blogId });
  const res = await platformFetch()(`https://app.metricool.com/api/v2/scheduler/posts?${qs}`, {
    method: "POST",
    headers: { "X-Mc-Auth": creds.userToken, "Content-Type": "application/json" },
    body: JSON.stringify(metricoolBody(req)),
  });
  const data = (await readJson(res)) as { data?: { id?: number | string; uuid?: string }; id?: number | string; uuid?: string; message?: string; detail?: string };
  if (!res.ok) throw httpError("Metricool", res.status, data.message ?? data.detail ?? JSON.stringify(data).slice(0, 300));
  const id = String(data.data?.uuid ?? data.data?.id ?? data.uuid ?? data.id ?? "");
  return {
    externalId: `metricool:${id}`,
    publishedAt: req.scheduledAt,
    scheduledRemotely: true,
    note: req.needsManualFinish ? "Metricool will send a phone notification to finish this story (stickers) by hand." : undefined,
  };
}
