import type { AccountMetrics, AudienceBreakdown, PostMetrics } from "@/domain/types";
import { config } from "../config";
import { hmacSha256Hex } from "../crypto";
import { formEncode, platformFetch, readJson, sleep } from "./http";
import {
  PlatformError,
  type ConnectionCtx,
  type HealthResult,
  type InboxMessage,
  type PlatformAdapter,
  type PostRef,
  type PublishRequest,
  type PublishResult,
  type ReplyTarget,
} from "./types";

/**
 * Meta Graph API (Instagram professional accounts via Facebook Login, and Facebook Pages).
 * Connections store the long-lived *page* access token; Instagram connections also keep the
 * linked page id in meta.pageId (needed for Instagram DMs via the Conversations API).
 */

type Params = Record<string, string | number | boolean | undefined | null | object>;

export class MetaGraph {
  constructor(
    private readonly token: string,
    private readonly version = config().meta.graphVersion,
    private readonly appSecret = config().meta.appSecret,
  ) {}

  private base(): string {
    return `https://graph.facebook.com/${this.version}`;
  }

  private auth(): Record<string, string> {
    const p: Record<string, string> = { access_token: this.token };
    if (this.appSecret) p.appsecret_proof = hmacSha256Hex(this.appSecret, this.token);
    return p;
  }

  private encode(params: Params): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      out[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    return out;
  }

  async get<T = Record<string, unknown>>(path: string, params: Params = {}): Promise<T> {
    const qs = new URLSearchParams({ ...this.encode(params), ...this.auth() });
    const res = await platformFetch()(`${this.base()}/${path}?${qs}`);
    return this.handle<T>(res);
  }

  async post<T = Record<string, unknown>>(path: string, params: Params = {}): Promise<T> {
    const res = await platformFetch()(`${this.base()}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formEncode({ ...this.encode(params), ...this.auth() }),
    });
    return this.handle<T>(res);
  }

  /** POST to an absolute URL (resumable upload hosts). */
  async postAbsolute<T = Record<string, unknown>>(url: string, headers: Record<string, string>): Promise<T> {
    const res = await platformFetch()(url, { method: "POST", headers: { Authorization: `OAuth ${this.token}`, ...headers } });
    return this.handle<T>(res);
  }

  private async handle<T>(res: Response): Promise<T> {
    const body = (await readJson(res)) as { error?: { message?: string; code?: number; error_subcode?: number; type?: string } };
    if (res.ok && !body.error) return body as T;
    const e = body.error ?? {};
    const code = e.code ?? res.status;
    const msg = `Meta API error ${code}${e.error_subcode ? `/${e.error_subcode}` : ""}: ${e.message ?? `HTTP ${res.status}`}`;
    throw new PlatformError(msg, {
      retryable: [1, 2, 4, 17, 32, 341, 613].includes(code) || res.status >= 500,
      authExpired: code === 190 || code === 102,
      permission: code === 10 || (code >= 200 && code < 300),
      status: res.status,
      code,
    });
  }
}

interface InsightRow {
  name: string;
  values?: Array<{ value: number | Record<string, number> }>;
  total_value?: { value?: number; breakdowns?: Array<{ results?: Array<{ dimension_values: string[]; value: number }> }> };
}

function insightValue(row: InsightRow): number | undefined {
  if (typeof row.total_value?.value === "number") return row.total_value.value;
  const v = row.values?.[0]?.value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0);
  return undefined;
}

/**
 * Request several insight metrics; when Meta rejects the set (retired/unsupported metric,
 * error #100), fall back to one request per metric and keep what works.
 */
export async function insightsAdaptive(
  g: MetaGraph,
  objectId: string,
  metrics: string[],
  extra: Params = {},
): Promise<{ values: Record<string, number>; unsupported: string[] }> {
  const parse = (data: { data?: InsightRow[] }) => {
    const out: Record<string, number> = {};
    for (const row of data.data ?? []) {
      const v = insightValue(row);
      if (v !== undefined) out[row.name] = v;
    }
    return out;
  };
  try {
    return { values: parse(await g.get(`${objectId}/insights`, { metric: metrics.join(","), ...extra })), unsupported: [] };
  } catch (err) {
    if (!(err instanceof PlatformError) || err.opts.code !== 100) throw err;
  }
  const values: Record<string, number> = {};
  const unsupported: string[] = [];
  for (const m of metrics) {
    try {
      Object.assign(values, parse(await g.get(`${objectId}/insights`, { metric: m, ...extra })));
    } catch (err) {
      if (err instanceof PlatformError && err.opts.code === 100) unsupported.push(m);
      else throw err;
    }
  }
  return { values, unsupported };
}

function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

// ---------------------------------------------------------------- Instagram

const IG_METRICS: Record<string, string[]> = {
  reel: ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"],
  post: ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "profile_visits", "follows"],
  carousel: ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "profile_visits", "follows"],
  story: ["views", "reach", "replies", "shares", "total_interactions", "profile_visits", "follows"],
};

export function mapIgMetrics(v: Record<string, number>): PostMetrics {
  const m: PostMetrics = {};
  if (v.views !== undefined) m.views = v.views;
  if (v.impressions !== undefined) m.impressions = v.impressions;
  if (v.reach !== undefined) m.reach = v.reach;
  if (v.likes !== undefined) m.likes = v.likes;
  if (v.comments !== undefined) m.comments = v.comments;
  if (v.shares !== undefined) m.shares = v.shares;
  if (v.saved !== undefined) m.saves = v.saved;
  if (v.profile_visits !== undefined) m.profileVisits = v.profile_visits;
  if (v.follows !== undefined) m.follows = v.follows;
  if (v.replies !== undefined) m.replies = v.replies;
  if (v.ig_reels_avg_watch_time !== undefined) m.avgWatchSec = v.ig_reels_avg_watch_time / 1000;
  return m;
}

async function waitForContainer(g: MetaGraph, containerId: string, timeoutMs = 6 * 60_000): Promise<void> {
  const started = Date.now();
  let delay = 3000;
  while (Date.now() - started < timeoutMs) {
    const s = await g.get<{ status_code?: string; status?: string }>(containerId, { fields: "status_code,status" });
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new PlatformError(`Instagram could not process the media: ${s.status ?? s.status_code}`, { retryable: false });
    }
    await sleep(delay);
    delay = Math.min(15000, delay * 1.5);
  }
  throw new PlatformError("Instagram media processing timed out", { retryable: true });
}

export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",

  async publish(conn: ConnectionCtx, req: PublishRequest): Promise<PublishResult> {
    const g = new MetaGraph(conn.accessToken);
    const ig = conn.accountId;
    const first = req.media[0];
    if (!first) throw new PlatformError("Instagram posts need at least one image or video", { retryable: false });
    let containerId: string;

    if (req.format === "story") {
      const c = await g.post<{ id: string }>(`${ig}/media`, first.kind === "video" ? { media_type: "STORIES", video_url: first.url } : { media_type: "STORIES", image_url: first.url });
      containerId = c.id;
    } else if (req.format === "carousel" && req.media.length > 1) {
      const children: string[] = [];
      for (const m of req.media.slice(0, 10)) {
        const child = await g.post<{ id: string }>(
          `${ig}/media`,
          m.kind === "video" ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: true } : { image_url: m.url, is_carousel_item: true, alt_text: m.altText },
        );
        if (m.kind === "video") await waitForContainer(g, child.id);
        children.push(child.id);
      }
      const c = await g.post<{ id: string }>(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: req.caption });
      containerId = c.id;
    } else if (first.kind === "video") {
      // Feed videos are published as Reels on Instagram.
      const c = await g.post<{ id: string }>(`${ig}/media`, {
        media_type: "REELS",
        video_url: first.url,
        caption: req.caption,
        share_to_feed: !req.trialReel,
        cover_url: first.coverUrl,
        thumb_offset: first.coverUrl ? undefined : first.coverAtMs,
        trial_params: req.trialReel ? { graduation_strategy: "MANUAL" } : undefined,
      });
      containerId = c.id;
    } else {
      const c = await g.post<{ id: string }>(`${ig}/media`, { image_url: first.url, caption: req.caption, alt_text: first.altText });
      containerId = c.id;
    }

    await waitForContainer(g, containerId);
    const published = await g.post<{ id: string }>(`${ig}/media_publish`, { creation_id: containerId });
    const info = await g.get<{ permalink?: string; timestamp?: string }>(published.id, { fields: "permalink,timestamp" }).catch(() => ({}) as { permalink?: string; timestamp?: string });
    if (req.firstComment && req.format !== "story") {
      await g.post(`${published.id}/comments`, { message: req.firstComment }).catch(() => undefined);
    }
    return { externalId: published.id, permalink: info.permalink, publishedAt: info.timestamp ? new Date(info.timestamp) : new Date() };
  },

  async postMetrics(conn: ConnectionCtx, posts: PostRef[]): Promise<Record<string, PostMetrics>> {
    const g = new MetaGraph(conn.accessToken);
    const out: Record<string, PostMetrics> = {};
    for (const p of posts) {
      const { values } = await insightsAdaptive(g, p.externalId, IG_METRICS[p.format] ?? IG_METRICS.post);
      out[p.externalId] = mapIgMetrics(values);
    }
    return out;
  },

  async accountMetrics(conn: ConnectionCtx, since: Date, until: Date): Promise<AccountMetrics> {
    const g = new MetaGraph(conn.accessToken);
    const { values } = await insightsAdaptive(g, conn.accountId, ["reach", "views", "accounts_engaged", "total_interactions", "profile_links_taps"], {
      period: "day",
      metric_type: "total_value",
      since: unix(since),
      until: unix(until),
    });
    const profile = await g.get<{ followers_count?: number }>(conn.accountId, { fields: "followers_count" });
    return {
      followers: profile.followers_count,
      reach: values.reach,
      views: values.views,
      engaged: values.accounts_engaged,
      interactions: values.total_interactions,
      linkClicks: values.profile_links_taps,
    };
  },

  async audience(conn: ConnectionCtx): Promise<AudienceBreakdown | null> {
    const g = new MetaGraph(conn.accessToken);
    const fetchBreakdown = async (breakdown: string) => {
      const params = { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown };
      let data: { data?: InsightRow[] };
      try {
        data = await g.get(`${conn.accountId}/insights`, { ...params, timeframe: "this_month" });
      } catch (err) {
        if (err instanceof PlatformError && err.opts.code === 100) data = await g.get(`${conn.accountId}/insights`, params);
        else throw err;
      }
      const results = data.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
      return results.map((r) => ({ name: r.dimension_values[0], value: r.value }));
    };
    try {
      const [age, gender, cities, countries] = await Promise.all(["age", "gender", "city", "country"].map(fetchBreakdown));
      const genderNames: Record<string, string> = { F: "Female", M: "Male", U: "Unknown" };
      return {
        age: Object.fromEntries(age.map((a) => [a.name, a.value])),
        gender: Object.fromEntries(gender.map((a) => [genderNames[a.name] ?? a.name, a.value])),
        cities: cities.sort((a, b) => b.value - a.value).slice(0, 10),
        countries: countries.sort((a, b) => b.value - a.value).slice(0, 10),
      };
    } catch (err) {
      // Demographics require ≥100 followers; treat "not enough data" as no data.
      if (err instanceof PlatformError && !err.opts.authExpired) return null;
      throw err;
    }
  },

  async listInbox(conn: ConnectionCtx, since: Date, recentPosts: PostRef[]): Promise<InboxMessage[]> {
    const g = new MetaGraph(conn.accessToken);
    const out: InboxMessage[] = [];
    type IgComment = { id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username?: string }; replies?: { data: IgComment[] } };
    for (const p of recentPosts) {
      const res = await g.get<{ data: IgComment[] }>(`${p.externalId}/comments`, {
        fields: "id,text,timestamp,username,from{id,username},replies{id,text,timestamp,username,from{id,username}}",
        limit: 50,
      });
      for (const c of res.data ?? []) {
        const items: Array<{ c: IgComment; parent?: string }> = [{ c }, ...(c.replies?.data ?? []).map((r) => ({ c: r, parent: c.id }))];
        for (const { c: x, parent } of items) {
          if (x.from?.id === conn.accountId || (conn.handle && x.username === conn.handle)) continue;
          const at = new Date(x.timestamp);
          if (at <= since) continue;
          out.push({
            kind: "comment",
            externalId: x.id,
            parentExternalId: parent,
            postExternalId: p.externalId,
            authorName: x.username,
            authorHandle: x.username,
            authorId: x.from?.id,
            text: x.text ?? "",
            receivedAt: at,
          });
        }
      }
    }
    const pageId = conn.meta.pageId as string | undefined;
    if (pageId) {
      type Msg = { id: string; created_time: string; message?: string; from?: { id: string; username?: string; name?: string } };
      const convs = await g
        .get<{ data: Array<{ id: string; messages?: { data: Msg[] } }> }>(`${pageId}/conversations`, {
          platform: "instagram",
          fields: "id,updated_time,messages.limit(5){id,created_time,message,from}",
          limit: 20,
        })
        .catch((err) => {
          if (err instanceof PlatformError && err.opts.permission) return { data: [] };
          throw err;
        });
      for (const conv of convs.data ?? []) {
        for (const m of conv.messages?.data ?? []) {
          if (!m.message || m.from?.id === conn.accountId) continue;
          const at = new Date(m.created_time);
          if (at <= since) continue;
          out.push({ kind: "dm", externalId: m.id, threadId: conv.id, authorId: m.from?.id, authorName: m.from?.username ?? m.from?.name, authorHandle: m.from?.username, text: m.message, receivedAt: at });
        }
      }
    }
    return out;
  },

  async reply(conn: ConnectionCtx, target: ReplyTarget, text: string): Promise<{ externalId: string }> {
    const g = new MetaGraph(conn.accessToken);
    if (target.kind === "dm") {
      const pageId = conn.meta.pageId as string | undefined;
      if (!pageId || !target.authorId) throw new PlatformError("Instagram DM reply needs the linked page and the sender id", { retryable: false });
      const r = await g.post<{ message_id?: string }>(`${pageId}/messages`, { recipient: { id: target.authorId }, message: { text }, messaging_type: "RESPONSE" });
      return { externalId: r.message_id ?? "" };
    }
    // Instagram only allows replies on top-level comments.
    const r = await g.post<{ id: string }>(`${target.threadId ?? target.externalId}/replies`, { message: text });
    return { externalId: r.id };
  },

  async hide(conn: ConnectionCtx, target: ReplyTarget): Promise<void> {
    await new MetaGraph(conn.accessToken).post(target.externalId, { hide: true });
  },

  async recentPublished(conn: ConnectionCtx, since: Date) {
    const res = await new MetaGraph(conn.accessToken).get<{ data?: Array<{ id: string; caption?: string; timestamp: string; permalink?: string }> }>(`${conn.accountId}/media`, {
      fields: "id,caption,timestamp,permalink",
      limit: 50,
    });
    return (res.data ?? [])
      .map((m) => ({ externalId: m.id, caption: m.caption ?? "", publishedAt: new Date(m.timestamp), permalink: m.permalink }))
      .filter((m) => m.publishedAt >= since);
  },

  async health(conn: ConnectionCtx): Promise<HealthResult> {
    try {
      const me = await new MetaGraph(conn.accessToken).get<{ username?: string }>(conn.accountId, { fields: "username,followers_count" });
      return { ok: true, message: me.username ? `@${me.username}` : undefined };
    } catch (err) {
      if (err instanceof PlatformError) return { ok: false, message: err.message };
      throw err;
    }
  },
};

// ---------------------------------------------------------------- Facebook Pages

export function mapFbMetrics(insights: Record<string, number>, fields: { shares?: { count?: number }; comments?: { summary?: { total_count?: number } }; reactions?: { summary?: { total_count?: number } } }): PostMetrics {
  const m: PostMetrics = {};
  const views = insights.post_media_view ?? insights.post_impressions ?? insights.total_video_views;
  const reach = insights.post_total_media_view_unique ?? insights.post_impressions_unique ?? insights.total_video_views_unique;
  if (views !== undefined) m.views = views;
  if (reach !== undefined) m.reach = reach;
  if (insights.post_clicks !== undefined) m.clicks = insights.post_clicks;
  if (insights.total_video_avg_time_watched !== undefined) m.avgWatchSec = insights.total_video_avg_time_watched / 1000;
  const reactions = fields.reactions?.summary?.total_count ?? insights.post_reactions_by_type_total;
  if (reactions !== undefined) m.likes = reactions;
  if (fields.comments?.summary?.total_count !== undefined) m.comments = fields.comments.summary.total_count;
  if (fields.shares?.count !== undefined) m.shares = fields.shares.count;
  return m;
}

async function fbUploadHostedVideo(g: MetaGraph, pageId: string, edge: "video_reels" | "video_stories", fileUrl: string): Promise<string> {
  const start = await g.post<{ video_id: string; upload_url: string }>(`${pageId}/${edge}`, { upload_phase: "start" });
  await g.postAbsolute(start.upload_url, { file_url: fileUrl });
  return start.video_id;
}

export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",

  async publish(conn: ConnectionCtx, req: PublishRequest): Promise<PublishResult> {
    const g = new MetaGraph(conn.accessToken);
    const page = conn.accountId;
    const first = req.media[0];
    if (!first) {
      const r = await g.post<{ id: string }>(`${page}/feed`, { message: req.caption });
      return { externalId: r.id, permalink: `https://www.facebook.com/${r.id}`, publishedAt: new Date() };
    }

    if (req.format === "reel" && first.kind === "video") {
      const videoId = await fbUploadHostedVideo(g, page, "video_reels", first.url);
      const fin = await g.post<{ success?: boolean; post_id?: string }>(`${page}/video_reels`, {
        upload_phase: "finish",
        video_id: videoId,
        video_state: "PUBLISHED",
        description: req.caption,
        title: req.title,
      });
      const id = fin.post_id ?? videoId;
      if (req.firstComment) await g.post(`${id}/comments`, { message: req.firstComment }).catch(() => undefined);
      return { externalId: id, permalink: `https://www.facebook.com/reel/${videoId}`, publishedAt: new Date() };
    }

    if (req.format === "story") {
      if (first.kind === "video") {
        const videoId = await fbUploadHostedVideo(g, page, "video_stories", first.url);
        const fin = await g.post<{ post_id?: string }>(`${page}/video_stories`, { upload_phase: "finish", video_id: videoId });
        return { externalId: fin.post_id ?? videoId, publishedAt: new Date() };
      }
      const photo = await g.post<{ id: string }>(`${page}/photos`, { url: first.url, published: false });
      const story = await g.post<{ post_id?: string; id?: string }>(`${page}/photo_stories`, { photo_id: photo.id });
      return { externalId: story.post_id ?? story.id ?? photo.id, publishedAt: new Date() };
    }

    let postId: string;
    if (req.media.length > 1) {
      const ids: string[] = [];
      for (const m of req.media.filter((x) => x.kind === "image").slice(0, 10)) {
        const p = await g.post<{ id: string }>(`${page}/photos`, { url: m.url, published: false, alt_text_custom: m.altText });
        ids.push(p.id);
      }
      const r = await g.post<{ id: string }>(`${page}/feed`, { message: req.caption, attached_media: ids.map((id) => ({ media_fbid: id })) });
      postId = r.id;
    } else if (first.kind === "video") {
      const r = await g.post<{ id: string }>(`${page}/videos`, { file_url: first.url, description: req.caption, title: req.title });
      postId = r.id;
    } else {
      const r = await g.post<{ id: string; post_id?: string }>(`${page}/photos`, { url: first.url, message: req.caption, published: true });
      postId = r.post_id ?? r.id;
    }
    if (req.firstComment) await g.post(`${postId}/comments`, { message: req.firstComment }).catch(() => undefined);
    return { externalId: postId, permalink: `https://www.facebook.com/${postId}`, publishedAt: new Date() };
  },

  async postMetrics(conn: ConnectionCtx, posts: PostRef[]): Promise<Record<string, PostMetrics>> {
    const g = new MetaGraph(conn.accessToken);
    const out: Record<string, PostMetrics> = {};
    for (const p of posts) {
      const metrics = ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total", "post_impressions", "post_impressions_unique"];
      const { values } = await insightsAdaptive(g, p.externalId, metrics).catch(() => ({ values: {} as Record<string, number> }));
      const fields = await g
        .get<{ shares?: { count?: number }; comments?: { summary?: { total_count?: number } }; reactions?: { summary?: { total_count?: number } } }>(p.externalId, {
          fields: "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)",
        })
        .catch(() => ({}));
      out[p.externalId] = mapFbMetrics(values, fields);
    }
    return out;
  },

  async accountMetrics(conn: ConnectionCtx, since: Date, until: Date): Promise<AccountMetrics> {
    const g = new MetaGraph(conn.accessToken);
    const page = await g.get<{ followers_count?: number; fan_count?: number }>(conn.accountId, { fields: "followers_count,fan_count" });
    const { values } = await insightsAdaptive(g, conn.accountId, ["page_media_view", "page_total_media_view_unique", "page_impressions_unique", "page_post_engagements", "page_views_total"], {
      period: "day",
      since: unix(since),
      until: unix(until),
    }).catch(() => ({ values: {} as Record<string, number> }));
    return {
      followers: page.followers_count ?? page.fan_count,
      views: values.page_media_view,
      reach: values.page_total_media_view_unique ?? values.page_impressions_unique,
      interactions: values.page_post_engagements,
      profileVisits: values.page_views_total,
    };
  },

  async audience(): Promise<AudienceBreakdown | null> {
    // Page demographic insights were retired; Instagram follower demographics cover Meta audiences.
    return null;
  },

  async listInbox(conn: ConnectionCtx, since: Date, recentPosts: PostRef[]): Promise<InboxMessage[]> {
    const g = new MetaGraph(conn.accessToken);
    const out: InboxMessage[] = [];
    type FbComment = { id: string; message?: string; created_time: string; from?: { id: string; name?: string }; parent?: { id: string } };
    for (const p of recentPosts) {
      const res = await g.get<{ data: FbComment[] }>(`${p.externalId}/comments`, { fields: "id,message,created_time,from{id,name},parent{id}", filter: "stream", limit: 50 });
      for (const c of res.data ?? []) {
        if (c.from?.id === conn.accountId) continue;
        const at = new Date(c.created_time);
        if (at <= since || !c.message) continue;
        out.push({ kind: "comment", externalId: c.id, parentExternalId: c.parent?.id, postExternalId: p.externalId, authorId: c.from?.id, authorName: c.from?.name, text: c.message, receivedAt: at });
      }
    }
    type Msg = { id: string; created_time: string; message?: string; from?: { id: string; name?: string } };
    const convs = await g
      .get<{ data: Array<{ id: string; messages?: { data: Msg[] } }> }>(`${conn.accountId}/conversations`, { fields: "id,messages.limit(5){id,created_time,message,from}", limit: 20 })
      .catch((err) => {
        if (err instanceof PlatformError && err.opts.permission) return { data: [] };
        throw err;
      });
    for (const conv of convs.data ?? []) {
      for (const m of conv.messages?.data ?? []) {
        if (!m.message || m.from?.id === conn.accountId) continue;
        const at = new Date(m.created_time);
        if (at <= since) continue;
        out.push({ kind: "dm", externalId: m.id, threadId: conv.id, authorId: m.from?.id, authorName: m.from?.name, text: m.message, receivedAt: at });
      }
    }
    return out;
  },

  async reply(conn: ConnectionCtx, target: ReplyTarget, text: string): Promise<{ externalId: string }> {
    const g = new MetaGraph(conn.accessToken);
    if (target.kind === "dm") {
      if (!target.authorId) throw new PlatformError("Messenger reply needs the sender id", { retryable: false });
      const r = await g.post<{ message_id?: string }>(`${conn.accountId}/messages`, { recipient: { id: target.authorId }, message: { text }, messaging_type: "RESPONSE" });
      return { externalId: r.message_id ?? "" };
    }
    const r = await g.post<{ id: string }>(`${target.externalId}/comments`, { message: text });
    return { externalId: r.id };
  },

  async hide(conn: ConnectionCtx, target: ReplyTarget): Promise<void> {
    await new MetaGraph(conn.accessToken).post(target.externalId, { is_hidden: true });
  },

  async recentPublished(conn: ConnectionCtx, since: Date) {
    const res = await new MetaGraph(conn.accessToken).get<{ data?: Array<{ id: string; message?: string; created_time: string; permalink_url?: string }> }>(`${conn.accountId}/published_posts`, {
      fields: "id,message,created_time,permalink_url",
      since: unix(since),
      limit: 50,
    });
    return (res.data ?? []).map((m) => ({ externalId: m.id, caption: m.message ?? "", publishedAt: new Date(m.created_time), permalink: m.permalink_url }));
  },

  async health(conn: ConnectionCtx): Promise<HealthResult> {
    try {
      const p = await new MetaGraph(conn.accessToken).get<{ name?: string }>(conn.accountId, { fields: "name" });
      return { ok: true, message: p.name };
    } catch (err) {
      if (err instanceof PlatformError) return { ok: false, message: err.message };
      throw err;
    }
  },
};
