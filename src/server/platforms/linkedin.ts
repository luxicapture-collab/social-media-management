import fs from "node:fs/promises";
import type { AccountMetrics, AudienceBreakdown, PostMetrics } from "@/domain/types";
import { config } from "../config";
import { httpError, platformFetch, readJson } from "./http";
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
 * LinkedIn Community Management API (versioned REST, https://api.linkedin.com/rest).
 * connection.accountId is the author URN: urn:li:organization:{id} (company page) or
 * urn:li:person:{id} (personal profile). LinkedIn has no DM API for these apps.
 */

const RESERVED = /[\\|{}@[\]()<>*_~]/g;

/** Escape text for LinkedIn's "little text format" and turn #tags into hashtag entities. */
export function toLittleText(text: string): string {
  const parts: string[] = [];
  let last = 0;
  const tagRe = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu;
  for (const m of text.matchAll(tagRe)) {
    const start = (m.index ?? 0) + m[1].length;
    parts.push(text.slice(last, start).replace(RESERVED, (c) => `\\${c}`).replace(/#/g, "\\#"));
    parts.push(`{hashtag|\\#|${m[2]}}`);
    last = start + 1 + m[2].length;
  }
  parts.push(text.slice(last).replace(RESERVED, (c) => `\\${c}`).replace(/#/g, "\\#"));
  return parts.join("");
}

export const SENIORITY: Record<string, string> = {
  "1": "Unpaid",
  "2": "Training",
  "3": "Entry",
  "4": "Senior",
  "5": "Manager",
  "6": "Director",
  "7": "VP",
  "8": "CXO",
  "9": "Partner",
  "10": "Owner",
};

export const FUNCTIONS: Record<string, string> = {
  "1": "Accounting",
  "2": "Administrative",
  "3": "Arts and Design",
  "4": "Business Development",
  "5": "Community and Social Services",
  "6": "Consulting",
  "7": "Education",
  "8": "Engineering",
  "9": "Entrepreneurship",
  "10": "Finance",
  "11": "Healthcare Services",
  "12": "Human Resources",
  "13": "Information Technology",
  "14": "Legal",
  "15": "Marketing",
  "16": "Media and Communication",
  "17": "Military and Protective Services",
  "18": "Operations",
  "19": "Product Management",
  "20": "Program and Project Management",
  "21": "Purchasing",
  "22": "Quality Assurance",
  "23": "Real Estate",
  "24": "Research",
  "25": "Sales",
  "26": "Customer Success and Support",
};

class LinkedInApi {
  constructor(private readonly token: string) {}

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "LinkedIn-Version": config().linkedin.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      ...extra,
    };
  }

  async request<T>(method: string, path: string, body?: unknown, query = ""): Promise<{ data: T; headers: Headers }> {
    const url = `https://api.linkedin.com/rest/${path}${query ? `?${query}` : ""}`;
    const res = await platformFetch()(url, {
      method,
      headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await readJson(res)) as T & { message?: string; serviceErrorCode?: number };
    if (!res.ok) throw httpError("LinkedIn", res.status, (data as { message?: string }).message ?? JSON.stringify(data).slice(0, 300));
    return { data, headers: res.headers };
  }

  async upload(uploadUrl: string, bytes: Buffer, contentType = "application/octet-stream"): Promise<string | null> {
    const res = await platformFetch()(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": contentType }, body: new Uint8Array(bytes) });
    if (!res.ok) throw httpError("LinkedIn upload", res.status, (await res.text()).slice(0, 200));
    return res.headers.get("etag");
  }
}

async function bytesOf(m: PublishMedia): Promise<Buffer> {
  if (m.localPath) return fs.readFile(m.localPath);
  const res = await platformFetch()(m.url);
  if (!res.ok) throw new PlatformError(`Could not download media for LinkedIn upload (${res.status})`, { retryable: true });
  return Buffer.from(await res.arrayBuffer());
}

async function uploadImage(api: LinkedInApi, owner: string, m: PublishMedia): Promise<string> {
  const init = await api.request<{ value: { uploadUrl: string; image: string } }>("POST", "images", { initializeUploadRequest: { owner } }, "action=initializeUpload");
  await api.upload(init.data.value.uploadUrl, await bytesOf(m), m.mime);
  return init.data.value.image;
}

async function uploadDocument(api: LinkedInApi, owner: string, m: PublishMedia): Promise<string> {
  const init = await api.request<{ value: { uploadUrl: string; document: string } }>("POST", "documents", { initializeUploadRequest: { owner } }, "action=initializeUpload");
  await api.upload(init.data.value.uploadUrl, await bytesOf(m), "application/pdf");
  return init.data.value.document;
}

async function uploadVideo(api: LinkedInApi, owner: string, m: PublishMedia): Promise<string> {
  const bytes = await bytesOf(m);
  const init = await api.request<{ value: { video: string; uploadToken?: string; uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> } }>(
    "POST",
    "videos",
    { initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } },
    "action=initializeUpload",
  );
  const etags: string[] = [];
  for (const ins of init.data.value.uploadInstructions) {
    const etag = await api.upload(ins.uploadUrl, bytes.subarray(ins.firstByte, ins.lastByte + 1));
    if (etag) etags.push(etag);
  }
  await api.request("POST", "videos", { finalizeUploadRequest: { video: init.data.value.video, uploadToken: init.data.value.uploadToken ?? "", uploadedPartIds: etags } }, "action=finalizeUpload");
  return init.data.value.video;
}

function encodeUrn(urn: string): string {
  return encodeURIComponent(urn);
}

function isOrg(urn: string): boolean {
  return urn.startsWith("urn:li:organization:");
}

export const linkedinAdapter: PlatformAdapter = {
  platform: "linkedin",

  async publish(conn: ConnectionCtx, req: PublishRequest): Promise<PublishResult> {
    const api = new LinkedInApi(conn.accessToken);
    const author = conn.accountId;
    let content: Record<string, unknown> | undefined;
    const images = req.media.filter((m) => m.kind === "image");
    const pdf = req.media.find((m) => m.kind === "pdf");
    const video = req.media.find((m) => m.kind === "video");

    if (pdf) {
      const doc = await uploadDocument(api, author, pdf);
      content = { media: { id: doc, title: (req.title ?? "Carousel").slice(0, 200) } };
    } else if (video) {
      const v = await uploadVideo(api, author, video);
      content = { media: { id: v, title: req.title?.slice(0, 200) } };
    } else if (images.length > 1) {
      const ids: string[] = [];
      for (const m of images.slice(0, 20)) ids.push(await uploadImage(api, author, m));
      content = { multiImage: { images: ids.map((id, i) => ({ id, altText: images[i].altText ?? "" })) } };
    } else if (images.length === 1) {
      const id = await uploadImage(api, author, images[0]);
      content = { media: { id, altText: images[0].altText ?? "" } };
    }

    const { headers } = await api.request("POST", "posts", {
      author,
      commentary: toLittleText(req.caption),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content ? { content } : {}),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
    const postUrn = headers.get("x-restli-id") ?? headers.get("x-linkedin-id") ?? "";
    if (!postUrn) throw new PlatformError("LinkedIn did not return the post id", { retryable: false });
    if (req.firstComment) {
      await api.request("POST", `socialActions/${encodeUrn(postUrn)}/comments`, { actor: author, object: postUrn, message: { text: req.firstComment } }).catch(() => undefined);
    }
    return { externalId: postUrn, permalink: `https://www.linkedin.com/feed/update/${postUrn}/`, publishedAt: new Date() };
  },

  async postMetrics(conn: ConnectionCtx, posts: PostRef[]): Promise<Record<string, PostMetrics>> {
    const api = new LinkedInApi(conn.accessToken);
    const out: Record<string, PostMetrics> = {};
    if (!posts.length) return out;
    if (isOrg(conn.accountId)) {
      const shares = posts.filter((p) => p.externalId.includes(":share:")).map((p) => encodeUrn(p.externalId));
      const ugc = posts.filter((p) => !p.externalId.includes(":share:")).map((p) => encodeUrn(p.externalId));
      const q = [`q=organizationalEntity`, `organizationalEntity=${encodeUrn(conn.accountId)}`];
      if (shares.length) q.push(`shares=List(${shares.join(",")})`);
      if (ugc.length) q.push(`ugcPosts=List(${ugc.join(",")})`);
      const { data } = await api.request<{
        elements?: Array<{ share?: string; ugcPost?: string; totalShareStatistics?: Record<string, number> }>;
      }>("GET", "organizationalEntityShareStatistics", undefined, q.join("&"));
      for (const el of data.elements ?? []) {
        const id = el.share ?? el.ugcPost;
        const s = el.totalShareStatistics;
        if (!id || !s) continue;
        out[id] = {
          impressions: s.impressionCount,
          reach: s.uniqueImpressionsCount,
          clicks: s.clickCount,
          likes: s.likeCount,
          comments: s.commentCount,
          shares: s.shareCount,
        };
      }
    }
    // Personal profiles (and anything missing above): social action summaries.
    for (const p of posts) {
      if (out[p.externalId]) continue;
      try {
        const { data } = await api.request<{ likesSummary?: { totalLikes?: number }; commentsSummary?: { aggregatedTotalComments?: number } }>("GET", `socialActions/${encodeUrn(p.externalId)}`);
        out[p.externalId] = { likes: data.likesSummary?.totalLikes, comments: data.commentsSummary?.aggregatedTotalComments };
      } catch {
        // leave unreported
      }
    }
    return out;
  },

  async accountMetrics(conn: ConnectionCtx, since: Date, until: Date): Promise<AccountMetrics> {
    const api = new LinkedInApi(conn.accessToken);
    if (!isOrg(conn.accountId)) return {};
    const urn = encodeUrn(conn.accountId);
    const size = await api.request<{ firstDegreeSize?: number }>("GET", `networkSizes/${urn}`, undefined, "edgeType=COMPANY_FOLLOWED_BY_MEMBER").catch(() => ({ data: {} as { firstDegreeSize?: number } }));
    const interval = `timeIntervals=(timeRange:(start:${since.getTime()},end:${until.getTime()}),timeGranularityType:DAY)`;
    const stats = await api
      .request<{ elements?: Array<{ totalShareStatistics?: Record<string, number> }> }>("GET", "organizationalEntityShareStatistics", undefined, `q=organizationalEntity&organizationalEntity=${urn}&${interval}`)
      .catch(() => ({ data: { elements: [] } }));
    const total = (stats.data.elements ?? []).reduce(
      (acc, el) => {
        const s = el.totalShareStatistics ?? {};
        acc.impressions += s.impressionCount ?? 0;
        acc.reach += s.uniqueImpressionsCount ?? 0;
        acc.clicks += s.clickCount ?? 0;
        acc.interactions += (s.likeCount ?? 0) + (s.commentCount ?? 0) + (s.shareCount ?? 0);
        return acc;
      },
      { impressions: 0, reach: 0, clicks: 0, interactions: 0 },
    );
    return {
      followers: size.data.firstDegreeSize,
      impressions: total.impressions || undefined,
      reach: total.reach || undefined,
      linkClicks: total.clicks || undefined,
      interactions: total.interactions || undefined,
    };
  },

  async audience(conn: ConnectionCtx): Promise<AudienceBreakdown | null> {
    if (!isOrg(conn.accountId)) return null;
    const api = new LinkedInApi(conn.accessToken);
    type Count = { followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number } };
    const { data } = await api.request<{
      elements?: Array<{
        followerCountsBySeniority?: Array<Count & { seniority: string }>;
        followerCountsByFunction?: Array<Count & { function: string }>;
        followerCountsByIndustry?: Array<Count & { industry: string }>;
        followerCountsByGeoCountry?: Array<Count & { geo: string }>;
      }>;
    }>("GET", "organizationalEntityFollowerStatistics", undefined, `q=organizationalEntity&organizationalEntity=${encodeUrn(conn.accountId)}`);
    const el = data.elements?.[0];
    if (!el) return null;
    const n = (c: Count) => (c.followerCounts?.organicFollowerCount ?? 0) + (c.followerCounts?.paidFollowerCount ?? 0);
    const id = (urn: string) => urn.split(":").pop() ?? urn;
    const top = <T extends Count>(rows: T[] | undefined, name: (r: T) => string) =>
      (rows ?? [])
        .map((r) => ({ name: name(r), value: n(r) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    return {
      seniorities: top(el.followerCountsBySeniority, (r) => SENIORITY[id(r.seniority)] ?? r.seniority),
      functions: top(el.followerCountsByFunction, (r) => FUNCTIONS[id(r.function)] ?? r.function),
      industries: top(el.followerCountsByIndustry, (r) => `Industry ${id(r.industry)}`),
      countries: top(el.followerCountsByGeoCountry, (r) => `Geo ${id(r.geo)}`),
    };
  },

  async listInbox(conn: ConnectionCtx, since: Date, recentPosts: PostRef[]): Promise<InboxMessage[]> {
    const api = new LinkedInApi(conn.accessToken);
    const out: InboxMessage[] = [];
    for (const p of recentPosts) {
      const { data } = await api.request<{
        elements?: Array<{ $URN?: string; id?: string; actor?: string; message?: { text?: string }; created?: { time?: number }; parentComment?: string }>;
      }>("GET", `socialActions/${encodeUrn(p.externalId)}/comments`, undefined, "count=50");
      for (const c of data.elements ?? []) {
        if (!c.message?.text || c.actor === conn.accountId) continue;
        const at = new Date(c.created?.time ?? Date.now());
        if (at <= since) continue;
        const urn = c.$URN ?? c.id ?? "";
        out.push({
          kind: "comment",
          externalId: urn,
          parentExternalId: c.parentComment,
          postExternalId: p.externalId,
          authorId: c.actor,
          authorName: c.actor?.startsWith("urn:li:organization:") ? "Company page" : "LinkedIn member",
          text: c.message.text,
          receivedAt: at,
          permalink: `https://www.linkedin.com/feed/update/${p.externalId}/`,
        });
      }
    }
    return out;
  },

  async reply(conn: ConnectionCtx, target: ReplyTarget, text: string): Promise<{ externalId: string }> {
    if (target.kind === "dm") throw new PlatformError("LinkedIn has no messaging API for pages", { retryable: false });
    if (!target.postExternalId) throw new PlatformError("LinkedIn reply needs the post URN", { retryable: false });
    const api = new LinkedInApi(conn.accessToken);
    const { data, headers } = await api.request<{ $URN?: string; id?: string }>("POST", `socialActions/${encodeUrn(target.postExternalId)}/comments`, {
      actor: conn.accountId,
      object: target.postExternalId,
      parentComment: target.externalId,
      message: { text },
    });
    return { externalId: data.$URN ?? data.id ?? headers.get("x-restli-id") ?? "" };
  },

  async recentPublished(conn: ConnectionCtx, since: Date) {
    const api = new LinkedInApi(conn.accessToken);
    const { data } = await api.request<{ elements?: Array<{ id: string; commentary?: string; publishedAt?: number; createdAt?: number }> }>(
      "GET",
      "posts",
      undefined,
      `q=author&author=${encodeUrn(conn.accountId)}&count=20&sortBy=LAST_MODIFIED`,
    );
    return (data.elements ?? [])
      .map((p) => ({ externalId: p.id, caption: (p.commentary ?? "").replace(/\\(.)/g, "$1"), publishedAt: new Date(p.publishedAt ?? p.createdAt ?? 0), permalink: `https://www.linkedin.com/feed/update/${p.id}/` }))
      .filter((p) => p.publishedAt >= since);
  },

  async health(conn: ConnectionCtx): Promise<HealthResult> {
    const api = new LinkedInApi(conn.accessToken);
    try {
      if (isOrg(conn.accountId)) {
        const { data } = await api.request<{ localizedName?: string }>("GET", `organizations/${conn.accountId.split(":").pop()}`);
        return { ok: true, message: data.localizedName, expiresAt: conn.tokenExpiresAt };
      }
      const res = await platformFetch()("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${conn.accessToken}` } });
      if (!res.ok) return { ok: false, message: `LinkedIn ${res.status}` };
      const u = (await res.json()) as { name?: string };
      return { ok: true, message: u.name, expiresAt: conn.tokenExpiresAt };
    } catch (err) {
      if (err instanceof PlatformError) return { ok: false, message: err.message };
      throw err;
    }
  },
};
