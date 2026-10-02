import fs from "node:fs/promises";
import type { AccountMetrics, PostMetrics } from "@/domain/types";
import { httpError, platformFetch, readJson, sleep } from "./http";
import {
  PlatformError,
  type ConnectionCtx,
  type HealthResult,
  type InboxMessage,
  type PlatformAdapter,
  type PostRef,
  type PublishMedia,
  type PublishRequest,
  type PublishResult,
  type ReplyTarget,
} from "./types";

/**
 * X API v2 with an OAuth 2.0 user token (PKCE). Media uses the v2 chunked upload:
 * POST /2/media/upload/initialize → POST /2/media/upload/{id}/append (JSON, base64 chunk)
 * → POST /2/media/upload/{id}/finalize → GET /2/media/upload?command=STATUS&media_id=…
 * The API is pay-per-use (≈$0.015/post, $0.20 with a link, $0.005/post read), so reads are lean.
 */

const BASE = "https://api.x.com/2";
const CHUNK = 2 * 1024 * 1024;

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await platformFetch()(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await readJson(res)) as T & { errors?: Array<{ message?: string; detail?: string }>; detail?: string; title?: string };
  if (!res.ok) {
    const msg = data.detail ?? data.title ?? data.errors?.[0]?.message ?? JSON.stringify(data).slice(0, 300);
    throw httpError("X", res.status, msg);
  }
  return data;
}

async function mediaBytes(m: PublishMedia): Promise<Buffer> {
  if (m.localPath) return fs.readFile(m.localPath);
  const res = await platformFetch()(m.url);
  if (!res.ok) throw new PlatformError(`Could not download media for X (${res.status})`, { retryable: true });
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadMedia(token: string, m: PublishMedia): Promise<string> {
  const bytes = await mediaBytes(m);
  const isVideo = m.kind === "video";
  const init = await call<{ data: { id: string } }>(token, "POST", "/media/upload/initialize", {
    media_type: isVideo ? "video/mp4" : m.mime === "image/png" ? "image/png" : "image/jpeg",
    total_bytes: bytes.length,
    media_category: isVideo ? "tweet_video" : "tweet_image",
  });
  const id = init.data.id;
  for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg++) {
    await call(token, "POST", `/media/upload/${id}/append`, { media: bytes.subarray(i, i + CHUNK).toString("base64"), segment_index: seg });
  }
  const fin = await call<{ data: { id: string; processing_info?: { state?: string; check_after_secs?: number } } }>(token, "POST", `/media/upload/${id}/finalize`);
  let info = fin.data.processing_info;
  const started = Date.now();
  while (info && info.state !== "succeeded") {
    if (info.state === "failed") throw new PlatformError("X failed to process the media", { retryable: false });
    if (Date.now() - started > 5 * 60_000) throw new PlatformError("X media processing timed out", { retryable: true });
    await sleep(Math.max(1, info.check_after_secs ?? 2) * 1000);
    const st = await call<{ data: { processing_info?: { state?: string; check_after_secs?: number } } }>(token, "GET", `/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`);
    info = st.data.processing_info;
  }
  return id;
}

export function mapXMetrics(t: {
  public_metrics?: Record<string, number>;
  non_public_metrics?: Record<string, number>;
  organic_metrics?: Record<string, number>;
}): PostMetrics {
  const pub = t.public_metrics ?? {};
  const np = t.non_public_metrics ?? {};
  const org = t.organic_metrics ?? {};
  return {
    impressions: pub.impression_count ?? org.impression_count ?? np.impression_count,
    likes: pub.like_count,
    comments: pub.reply_count,
    shares: (pub.retweet_count ?? 0) + (pub.quote_count ?? 0),
    saves: pub.bookmark_count,
    clicks: np.url_link_clicks ?? org.url_link_clicks,
    profileVisits: np.user_profile_clicks ?? org.user_profile_clicks,
    videoViews: org.view_count,
  };
}

export const xAdapter: PlatformAdapter = {
  platform: "x",

  async publish(conn: ConnectionCtx, req: PublishRequest): Promise<PublishResult> {
    const mediaIds: string[] = [];
    const video = req.media.find((m) => m.kind === "video");
    if (video) mediaIds.push(await uploadMedia(conn.accessToken, video));
    else for (const m of req.media.filter((x) => x.kind === "image").slice(0, 4)) mediaIds.push(await uploadMedia(conn.accessToken, m));
    const res = await call<{ data: { id: string } }>(conn.accessToken, "POST", "/tweets", {
      text: req.caption,
      ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
    });
    const handle = conn.handle ?? "i";
    return { externalId: res.data.id, permalink: `https://x.com/${handle}/status/${res.data.id}`, publishedAt: new Date() };
  },

  async postMetrics(conn: ConnectionCtx, posts: PostRef[]): Promise<Record<string, PostMetrics>> {
    const out: Record<string, PostMetrics> = {};
    for (let i = 0; i < posts.length; i += 100) {
      const batch = posts.slice(i, i + 100);
      const recent = batch.every((p) => Date.now() - p.publishedAt.getTime() < 29 * 86_400_000);
      const fields = recent ? "public_metrics,non_public_metrics,organic_metrics" : "public_metrics";
      const res = await call<{ data?: Array<{ id: string; public_metrics?: Record<string, number>; non_public_metrics?: Record<string, number>; organic_metrics?: Record<string, number> }> }>(
        conn.accessToken,
        "GET",
        `/tweets?ids=${batch.map((p) => p.externalId).join(",")}&tweet.fields=${fields}`,
      );
      for (const t of res.data ?? []) out[t.id] = mapXMetrics(t);
    }
    return out;
  },

  async accountMetrics(conn: ConnectionCtx): Promise<AccountMetrics> {
    const res = await call<{ data: { public_metrics?: { followers_count?: number } } }>(conn.accessToken, "GET", "/users/me?user.fields=public_metrics");
    return { followers: res.data.public_metrics?.followers_count };
  },

  async audience(): Promise<null> {
    return null; // X exposes no audience demographics via the API.
  },

  async listInbox(conn: ConnectionCtx, since: Date): Promise<InboxMessage[]> {
    const out: InboxMessage[] = [];
    const sinceIso = new Date(Math.max(since.getTime(), Date.now() - 6 * 86_400_000)).toISOString();
    const mentions = await call<{
      data?: Array<{ id: string; text: string; author_id: string; created_at: string; conversation_id?: string; in_reply_to_user_id?: string }>;
      includes?: { users?: Array<{ id: string; username: string; name: string }> };
    }>(
      conn.accessToken,
      "GET",
      `/users/${conn.accountId}/mentions?start_time=${encodeURIComponent(sinceIso)}&max_results=50&tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id&expansions=author_id&user.fields=username,name`,
    );
    const users = new Map((mentions.includes?.users ?? []).map((u) => [u.id, u]));
    for (const t of mentions.data ?? []) {
      if (t.author_id === conn.accountId) continue;
      const u = users.get(t.author_id);
      out.push({
        kind: "mention",
        externalId: t.id,
        threadId: t.conversation_id,
        authorId: t.author_id,
        authorHandle: u?.username,
        authorName: u?.name,
        text: t.text,
        receivedAt: new Date(t.created_at),
        permalink: u ? `https://x.com/${u.username}/status/${t.id}` : undefined,
      });
    }
    if (conn.meta.readDms) {
      const dms = await call<{ data?: Array<{ id: string; text?: string; sender_id?: string; created_at?: string; dm_conversation_id?: string; event_type?: string }> }>(
        conn.accessToken,
        "GET",
        `/dm_events?event_types=MessageCreate&max_results=50&dm_event.fields=created_at,sender_id,text,dm_conversation_id`,
      ).catch(() => ({ data: [] }));
      for (const d of dms.data ?? []) {
        if (!d.text || d.sender_id === conn.accountId) continue;
        const at = new Date(d.created_at ?? Date.now());
        if (at <= since) continue;
        out.push({ kind: "dm", externalId: d.id, threadId: d.dm_conversation_id, authorId: d.sender_id, text: d.text, receivedAt: at });
      }
    }
    return out;
  },

  async reply(conn: ConnectionCtx, target: ReplyTarget, text: string): Promise<{ externalId: string }> {
    if (target.kind === "dm") {
      if (!target.authorId) throw new PlatformError("X DM reply needs the sender id", { retryable: false });
      const r = await call<{ data?: { dm_event_id?: string } }>(conn.accessToken, "POST", `/dm_conversations/with/${target.authorId}/messages`, { text });
      return { externalId: r.data?.dm_event_id ?? "" };
    }
    const r = await call<{ data: { id: string } }>(conn.accessToken, "POST", "/tweets", { text, reply: { in_reply_to_tweet_id: target.externalId } });
    return { externalId: r.data.id };
  },

  async hide(conn: ConnectionCtx, target: ReplyTarget): Promise<void> {
    await call(conn.accessToken, "PUT", `/tweets/${target.externalId}/hidden`, { hidden: true });
  },

  async recentPublished(conn: ConnectionCtx, since: Date) {
    const res = await call<{ data?: Array<{ id: string; text: string; created_at: string }> }>(
      conn.accessToken,
      "GET",
      `/users/${conn.accountId}/tweets?max_results=20&tweet.fields=created_at&start_time=${encodeURIComponent(since.toISOString())}`,
    );
    return (res.data ?? []).map((t) => ({ externalId: t.id, caption: t.text, publishedAt: new Date(t.created_at), permalink: `https://x.com/${conn.handle ?? "i"}/status/${t.id}` }));
  },

  async health(conn: ConnectionCtx): Promise<HealthResult> {
    try {
      const me = await call<{ data: { username: string } }>(conn.accessToken, "GET", "/users/me");
      return { ok: true, message: `@${me.data.username}`, expiresAt: conn.tokenExpiresAt };
    } catch (err) {
      if (err instanceof PlatformError) return { ok: false, message: err.message };
      throw err;
    }
  },
};
