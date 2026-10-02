import type { AccountMetrics, AudienceBreakdown, Platform, PostMetrics } from "@/domain/types";
import { sha256Hex } from "../crypto";
import type { ConnectionCtx, InboxMessage, PlatformAdapter, PostRef, PublishRequest, PublishResult, ReplyTarget } from "./types";

/**
 * Simulated platform for demo mode. Publishing returns fake ids; metrics follow plausible,
 * deterministic growth curves per post so analytics, pacing and pivots can be exercised.
 */

function rand(seed: string, min: number, max: number): number {
  const n = parseInt(sha256Hex(seed).slice(0, 8), 16) / 0xffffffff;
  return min + n * (max - min);
}

const FORMAT_REACH: Record<string, number> = { reel: 0.9, story: 0.18, post: 0.32, carousel: 0.42 };

export function demoPostMetrics(platform: Platform, post: PostRef, followers: number, now = new Date()): PostMetrics {
  const age = Math.max(0, (now.getTime() - post.publishedAt.getTime()) / 3_600_000);
  const curve = 1 - Math.exp(-age / 20);
  const base = followers * (FORMAT_REACH[post.format] ?? 0.3) * rand(`${post.externalId}:q`, 0.45, 1.6) * (platform === "x" ? 0.25 : platform === "linkedin" ? 0.35 : 1);
  const reach = Math.round(base * curve);
  const views = Math.round(reach * (post.format === "reel" ? rand(`${post.externalId}:v`, 1.2, 1.8) : 1.1));
  const m: PostMetrics = {
    reach,
    views,
    likes: Math.round(reach * rand(`${post.externalId}:l`, 0.025, 0.07)),
    comments: Math.round(reach * rand(`${post.externalId}:c`, 0.002, 0.008)),
    shares: Math.round(reach * rand(`${post.externalId}:s`, 0.002, 0.012)),
    saves: Math.round(reach * rand(`${post.externalId}:sv`, 0.003, 0.02)),
    profileVisits: Math.round(reach * rand(`${post.externalId}:pv`, 0.006, 0.02)),
    follows: Math.round(reach * rand(`${post.externalId}:f`, 0.0008, 0.004)),
  };
  if (post.format === "reel") {
    m.retention3s = Number(rand(`${post.externalId}:r`, 0.3, 0.72).toFixed(3));
    m.avgWatchSec = Number(rand(`${post.externalId}:w`, 3.5, 9).toFixed(1));
  }
  if (platform === "linkedin" || platform === "x") {
    m.impressions = Math.round(reach * 1.6);
    m.clicks = Math.round(reach * rand(`${post.externalId}:k`, 0.004, 0.015));
  }
  return m;
}

const SAMPLE_COMMENTS = [
  { text: "This gave me chills. Who did the colour grade?", author: "nadia.films" },
  { text: "How much for a full-day wedding film?", author: "sara_and_omid" },
  { text: "قیمت فیلمبرداری عروسی چقدره؟", author: "maryam.r" },
  { text: "Absolutely stunning work 🤍", author: "lena.travels" },
  { text: "Promote your page on our network! DM us for 10k followers", author: "growth.boost.pro" },
  { text: "Is this shot on film or digital?", author: "kodak.kid" },
];

export function demoAdapter(platform: Platform): PlatformAdapter {
  return {
    platform,
    async publish(conn: ConnectionCtx, req: PublishRequest): Promise<PublishResult> {
      const id = `demo_${platform}_${sha256Hex(`${conn.id}:${req.caption}:${Date.now()}`).slice(0, 12)}`;
      return { externalId: id, permalink: undefined, publishedAt: new Date(), note: "Simulated publish (demo connection)." };
    },
    async postMetrics(conn: ConnectionCtx, posts: PostRef[]) {
      const followers = Number(conn.meta.followers ?? 4200);
      return Object.fromEntries(posts.map((p) => [p.externalId, demoPostMetrics(platform, p, followers)]));
    },
    async accountMetrics(conn: ConnectionCtx, since: Date): Promise<AccountMetrics> {
      const base = Number(conn.meta.followers ?? 4200);
      const day = Math.floor(since.getTime() / 86_400_000);
      const growth = Math.round((day % 365) * rand(`${conn.id}:g`, 3, 9));
      return {
        followers: base + growth,
        reach: Math.round(base * rand(`${conn.id}:${day}:r`, 0.2, 0.55)),
        views: Math.round(base * rand(`${conn.id}:${day}:v`, 0.4, 1.1)),
        profileVisits: Math.round(base * rand(`${conn.id}:${day}:p`, 0.01, 0.04)),
        linkClicks: Math.round(base * rand(`${conn.id}:${day}:k`, 0.002, 0.01)),
        interactions: Math.round(base * rand(`${conn.id}:${day}:i`, 0.02, 0.06)),
      };
    },
    async audience(): Promise<AudienceBreakdown | null> {
      if (platform === "x") return null;
      if (platform === "linkedin") {
        return {
          seniorities: [
            { name: "Senior", value: 340 },
            { name: "Manager", value: 260 },
            { name: "Owner", value: 180 },
            { name: "Director", value: 120 },
          ],
          functions: [
            { name: "Marketing", value: 310 },
            { name: "Arts and Design", value: 240 },
            { name: "Business Development", value: 150 },
          ],
        };
      }
      return {
        age: { "18-24": 13, "25-34": 42, "35-44": 27, "45-54": 11, "55-64": 5, "65+": 2 },
        gender: { Female: 61, Male: 38, Unknown: 1 },
        cities: [
          { name: "Dubai", value: 820 },
          { name: "Tehran", value: 610 },
          { name: "London", value: 340 },
          { name: "Toronto", value: 290 },
          { name: "Istanbul", value: 210 },
        ],
        countries: [
          { name: "AE", value: 1100 },
          { name: "IR", value: 900 },
          { name: "GB", value: 420 },
          { name: "CA", value: 380 },
        ],
      };
    },
    async listInbox(_conn: ConnectionCtx, since: Date, recentPosts: PostRef[]): Promise<InboxMessage[]> {
      if (platform === "x" || platform === "linkedin") return [];
      const out: InboxMessage[] = [];
      const now = Date.now();
      for (const p of recentPosts) {
        const ageH = (now - p.publishedAt.getTime()) / 3_600_000;
        const count = Math.min(SAMPLE_COMMENTS.length, Math.floor(ageH / 2));
        for (let i = 0; i < count; i++) {
          const at = new Date(p.publishedAt.getTime() + (i + 1) * 2 * 3_600_000);
          if (at <= since || at.getTime() > now) continue;
          const sample = SAMPLE_COMMENTS[(parseInt(sha256Hex(p.externalId).slice(0, 4), 16) + i) % SAMPLE_COMMENTS.length];
          out.push({
            kind: "comment",
            externalId: `${p.externalId}_c${i}`,
            postExternalId: p.externalId,
            authorName: sample.author,
            authorHandle: sample.author,
            text: sample.text,
            receivedAt: at,
          });
        }
      }
      return out;
    },
    async reply(_conn: ConnectionCtx, target: ReplyTarget): Promise<{ externalId: string }> {
      return { externalId: `${target.externalId}_reply` };
    },
    async hide(): Promise<void> {},
    async health(conn: ConnectionCtx) {
      return { ok: true, message: `Demo ${platform} account ${conn.handle ?? ""}`.trim() };
    },
  };
}
