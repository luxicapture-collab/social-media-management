import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/server/config";
import { setPlatformFetchForTests } from "@/server/platforms/http";
import { toLittleText, linkedinAdapter } from "@/server/platforms/linkedin";
import { insightsAdaptive, instagramAdapter, mapIgMetrics, MetaGraph, facebookAdapter } from "@/server/platforms/meta";
import { metricoolBody } from "@/server/platforms/metricool";
import { mapXMetrics, xAdapter } from "@/server/platforms/x";
import { demoPostMetrics } from "@/server/platforms/demo";
import type { ConnectionCtx, PublishRequest } from "@/server/platforms/types";

interface Call {
  method: string;
  url: string;
  body?: string;
  headers: Record<string, string>;
}

function fakeFetch(routes: Array<{ match: (c: Call) => boolean; respond: (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } }>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = init?.body === undefined || init?.body === null ? undefined : typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "[binary]";
    const call: Call = { method: init?.method ?? "GET", url, body, headers };
    calls.push(call);
    const route = routes.find((r) => r.match(call));
    if (!route) return new Response(JSON.stringify({ error: { message: `no route for ${call.method} ${url}` } }), { status: 404 });
    const r = route.respond(call);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { f, calls };
}

const conn = (over: Partial<ConnectionCtx> = {}): ConnectionCtx => ({
  id: "con_1",
  clientId: "luxi",
  platform: "instagram",
  accountId: "1784",
  accessToken: "PAGE_TOKEN",
  meta: { pageId: "999" },
  mode: "live",
  ...over,
});

const req = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  platform: "instagram",
  format: "reel",
  caption: "Watch the left side of the frame.\n\n#cinematic",
  media: [{ kind: "video", url: "https://cdn.example/reel.mp4", mime: "video/mp4", coverAtMs: 6000 }],
  firstComment: "Full film on our site",
  aiGenerated: true,
  scheduledAt: new Date("2026-10-05T15:30:00Z"),
  timezone: "Asia/Dubai",
  ...over,
});

beforeAll(() => {
  process.env.META_APP_SECRET = "app-secret";
  process.env.META_GRAPH_VERSION = "v25.0";
  resetConfigForTests();
});

afterEach(() => setPlatformFetchForTests(undefined));

describe("Instagram", () => {
  it("publishes a reel: container → wait FINISHED → media_publish → first comment", async () => {
    let polls = 0;
    const { f, calls } = fakeFetch([
      { match: (c) => c.method === "POST" && c.url.endsWith("/1784/media"), respond: () => ({ json: { id: "C1" } }) },
      { match: (c) => c.method === "GET" && c.url.includes("/C1?"), respond: () => ({ json: { status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" } }) },
      { match: (c) => c.url.endsWith("/1784/media_publish"), respond: () => ({ json: { id: "M1" } }) },
      { match: (c) => c.method === "GET" && c.url.includes("/M1?"), respond: () => ({ json: { permalink: "https://instagram.com/reel/abc", timestamp: "2026-10-05T15:30:01+0000" } }) },
      { match: (c) => c.url.endsWith("/M1/comments"), respond: () => ({ json: { id: "CM1" } }) },
    ]);
    setPlatformFetchForTests(f);
    const r = await instagramAdapter.publish(conn(), req());
    expect(r.externalId).toBe("M1");
    expect(r.permalink).toBe("https://instagram.com/reel/abc");
    const create = new URLSearchParams(calls[0].body);
    expect(create.get("media_type")).toBe("REELS");
    expect(create.get("video_url")).toBe("https://cdn.example/reel.mp4");
    expect(create.get("share_to_feed")).toBe("true");
    expect(create.get("thumb_offset")).toBe("6000");
    expect(create.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.some((c) => c.url.endsWith("/M1/comments"))).toBe(true);
  }, 30_000);

  it("sends trial_params for Trial Reels and keeps them off the feed", async () => {
    const { f, calls } = fakeFetch([
      { match: (c) => c.url.endsWith("/1784/media"), respond: () => ({ json: { id: "C2" } }) },
      { match: (c) => c.url.includes("/C2?"), respond: () => ({ json: { status_code: "FINISHED" } }) },
      { match: (c) => c.url.endsWith("/media_publish"), respond: () => ({ json: { id: "M2" } }) },
      { match: (c) => c.url.includes("/M2"), respond: () => ({ json: {} }) },
    ]);
    setPlatformFetchForTests(f);
    await instagramAdapter.publish(conn(), req({ trialReel: true, firstComment: undefined }));
    const create = new URLSearchParams(calls[0].body);
    expect(create.get("share_to_feed")).toBe("false");
    expect(JSON.parse(create.get("trial_params")!)).toEqual({ graduation_strategy: "MANUAL" });
  });

  it("builds carousels from child containers", async () => {
    let n = 0;
    const { f, calls } = fakeFetch([
      { match: (c) => c.method === "POST" && c.url.endsWith("/1784/media"), respond: () => ({ json: { id: `K${++n}` } }) },
      { match: (c) => c.method === "GET" && /\/K\d\?/.test(c.url), respond: () => ({ json: { status_code: "FINISHED" } }) },
      { match: (c) => c.url.endsWith("/media_publish"), respond: () => ({ json: { id: "M3" } }) },
      { match: (c) => c.url.includes("/M3"), respond: () => ({ json: {} }) },
    ]);
    setPlatformFetchForTests(f);
    await instagramAdapter.publish(
      conn(),
      req({ format: "carousel", firstComment: undefined, media: [1, 2, 3].map((i) => ({ kind: "image" as const, url: `https://cdn.example/${i}.jpg`, mime: "image/jpeg" })) }),
    );
    const parent = new URLSearchParams(calls.filter((c) => c.method === "POST" && c.url.endsWith("/1784/media"))[3].body);
    expect(parent.get("media_type")).toBe("CAROUSEL");
    expect(parent.get("children")).toBe("K1,K2,K3");
  });

  it("falls back per metric when Meta rejects a retired metric (#100)", async () => {
    const { f } = fakeFetch([
      {
        match: (c) => c.url.includes("/M9/insights") && c.url.includes("metric=views%2Creach%2Cplays"),
        respond: () => ({ status: 400, json: { error: { code: 100, message: "(#100) metric[2] must be one of ..." } } }),
      },
      { match: (c) => c.url.includes("/M9/insights") && c.url.includes("metric=plays"), respond: () => ({ status: 400, json: { error: { code: 100, message: "unsupported" } } }) },
      { match: (c) => c.url.includes("/M9/insights") && c.url.includes("metric=views"), respond: () => ({ json: { data: [{ name: "views", values: [{ value: 1200 }] }] } }) },
      { match: (c) => c.url.includes("/M9/insights") && c.url.includes("metric=reach"), respond: () => ({ json: { data: [{ name: "reach", total_value: { value: 900 } }] } }) },
    ]);
    setPlatformFetchForTests(f);
    const r = await insightsAdaptive(new MetaGraph("t"), "M9", ["views", "reach", "plays"]);
    expect(r.values).toEqual({ views: 1200, reach: 900 });
    expect(r.unsupported).toEqual(["plays"]);
  });

  it("maps metric names", () => {
    expect(mapIgMetrics({ views: 10, saved: 2, ig_reels_avg_watch_time: 4500, profile_visits: 3 })).toEqual({ views: 10, saves: 2, avgWatchSec: 4.5, profileVisits: 3 });
  });

  it("marks expired tokens (code 190)", async () => {
    const { f } = fakeFetch([{ match: () => true, respond: () => ({ status: 400, json: { error: { code: 190, message: "Session has expired" } } }) }]);
    setPlatformFetchForTests(f);
    const h = await instagramAdapter.health(conn());
    expect(h.ok).toBe(false);
    expect(h.message).toMatch(/190/);
  });
});

describe("Facebook", () => {
  it("publishes a reel via the three-phase video_reels upload", async () => {
    const { f, calls } = fakeFetch([
      { match: (c) => c.url.endsWith("/999/video_reels") && c.body?.includes("upload_phase=start") === true, respond: () => ({ json: { video_id: "V1", upload_url: "https://rupload.facebook.com/video-upload/v25.0/V1" } }) },
      { match: (c) => c.url.startsWith("https://rupload.facebook.com"), respond: () => ({ json: { success: true } }) },
      { match: (c) => c.url.endsWith("/999/video_reels") && c.body?.includes("upload_phase=finish") === true, respond: () => ({ json: { success: true, post_id: "P1" } }) },
      { match: (c) => c.url.endsWith("/P1/comments"), respond: () => ({ json: { id: "x" } }) },
    ]);
    setPlatformFetchForTests(f);
    const r = await facebookAdapter.publish(conn({ platform: "facebook", accountId: "999" }), req({ platform: "facebook" }));
    expect(r.externalId).toBe("P1");
    const upload = calls.find((c) => c.url.startsWith("https://rupload"))!;
    expect(upload.headers["file_url"]).toBe("https://cdn.example/reel.mp4");
    expect(upload.headers["authorization"]).toBe("OAuth PAGE_TOKEN");
  });
});

describe("LinkedIn", () => {
  it("escapes little-text and converts hashtags", () => {
    expect(toLittleText("Lesson (one): light first #filmmaking")).toBe("Lesson \\(one\\): light first {hashtag|\\#|filmmaking}");
    expect(toLittleText("Use @ and _ carefully")).toBe("Use \\@ and \\_ carefully");
  });

  it("uploads an image and creates a post with the version header", async () => {
    process.env.LINKEDIN_API_VERSION = "202608";
    resetConfigForTests();
    const { f, calls } = fakeFetch([
      { match: (c) => c.url.includes("/rest/images?action=initializeUpload"), respond: () => ({ json: { value: { uploadUrl: "https://upload.linkedin.example/img", image: "urn:li:image:1" } } }) },
      { match: (c) => c.method === "PUT" && c.url === "https://upload.linkedin.example/img", respond: () => ({ status: 201 }) },
      { match: (c) => c.url === "https://cdn.example/1.jpg", respond: () => ({ json: {} }) },
      { match: (c) => c.method === "POST" && c.url.endsWith("/rest/posts"), respond: () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:77" } }) },
      { match: (c) => c.url.includes("/socialActions/"), respond: () => ({ status: 201, json: {} }) },
    ]);
    setPlatformFetchForTests(f);
    const r = await linkedinAdapter.publish(
      conn({ platform: "linkedin", accountId: "urn:li:organization:42" }),
      req({ platform: "linkedin", format: "post", caption: "Insight (first).", media: [{ kind: "image", url: "https://cdn.example/1.jpg", mime: "image/jpeg" }] }),
    );
    expect(r.externalId).toBe("urn:li:share:77");
    const post = calls.find((c) => c.url.endsWith("/rest/posts"))!;
    expect(post.headers["linkedin-version"]).toBe("202608");
    expect(post.headers["x-restli-protocol-version"]).toBe("2.0.0");
    const body = JSON.parse(post.body!);
    expect(body.author).toBe("urn:li:organization:42");
    expect(body.commentary).toBe("Insight \\(first\\).");
    expect(body.content.media.id).toBe("urn:li:image:1");
    expect(calls.some((c) => c.url.includes("/socialActions/urn%3Ali%3Ashare%3A77/comments"))).toBe(true);
  });
});

describe("X", () => {
  it("uploads media in chunks and posts", async () => {
    const { f, calls } = fakeFetch([
      { match: (c) => c.url === "https://cdn.example/1.jpg", respond: () => ({ json: { pretend: "jpeg bytes" } }) },
      { match: (c) => c.url.endsWith("/2/media/upload/initialize"), respond: () => ({ json: { data: { id: "MED1" } } }) },
      { match: (c) => c.url.endsWith("/2/media/upload/MED1/append"), respond: () => ({ json: {} }) },
      { match: (c) => c.url.endsWith("/2/media/upload/MED1/finalize"), respond: () => ({ json: { data: { id: "MED1" } } }) },
      { match: (c) => c.url.endsWith("/2/tweets"), respond: () => ({ json: { data: { id: "T1" } } }) },
    ]);
    setPlatformFetchForTests(f);
    const r = await xAdapter.publish(conn({ platform: "x", accountId: "u1", handle: "luxi" }), req({ platform: "x", format: "post", caption: "One sharp idea.", media: [{ kind: "image", url: "https://cdn.example/1.jpg", mime: "image/jpeg" }] }));
    expect(r.permalink).toBe("https://x.com/luxi/status/T1");
    const init = JSON.parse(calls.find((c) => c.url.endsWith("/initialize"))!.body!);
    expect(init).toMatchObject({ media_type: "image/jpeg", media_category: "tweet_image" });
    const append = JSON.parse(calls.find((c) => c.url.endsWith("/append"))!.body!);
    expect(append.segment_index).toBe(0);
    expect(typeof append.media).toBe("string");
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/2/tweets"))!.body!)).toEqual({ text: "One sharp idea.", media: { media_ids: ["MED1"] } });
  });

  it("maps public and private metrics", () => {
    expect(mapXMetrics({ public_metrics: { impression_count: 500, like_count: 20, reply_count: 3, retweet_count: 2, quote_count: 1, bookmark_count: 4 }, non_public_metrics: { url_link_clicks: 7, user_profile_clicks: 5 } })).toMatchObject({
      impressions: 500,
      likes: 20,
      comments: 3,
      shares: 3,
      saves: 4,
      clicks: 7,
      profileVisits: 5,
    });
  });
});

describe("Metricool route", () => {
  it("builds a per-platform post with AI label and local publication time", () => {
    const body = metricoolBody(req({ trialReel: true }));
    expect(body.providers).toEqual([{ network: "instagram" }]);
    expect(body.publicationDate).toEqual({ dateTime: "2026-10-05T19:30:00", timezone: "Asia/Dubai" });
    expect(body.instagramData).toMatchObject({ type: "TRIAL_REEL", isAiGenerated: true, showReelOnFeed: false });
    expect(body.videoCoverMilliseconds).toBe(6000);
    const li = metricoolBody(req({ platform: "linkedin", format: "carousel", title: "5 lessons", media: [{ kind: "image", url: "https://a/1.jpg", mime: "image/jpeg" }] }));
    expect(li.linkedinData).toMatchObject({ publishImagesAsPDF: true, documentTitle: "5 lessons" });
    const x = metricoolBody(req({ platform: "x", format: "post" }));
    expect(x.providers).toEqual([{ network: "twitter" }]);
  });
});

describe("demo platform", () => {
  it("grows metrics over time deterministically", () => {
    const post = { externalId: "demo_1", format: "reel" as const, publishedAt: new Date("2026-10-01T10:00:00Z") };
    const early = demoPostMetrics("instagram", post, 5000, new Date("2026-10-01T12:00:00Z"));
    const late = demoPostMetrics("instagram", post, 5000, new Date("2026-10-04T12:00:00Z"));
    expect(late.reach!).toBeGreaterThan(early.reach!);
    expect(demoPostMetrics("instagram", post, 5000, new Date("2026-10-04T12:00:00Z"))).toEqual(late);
  });
});
