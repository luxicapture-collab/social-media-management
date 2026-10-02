import { describe, expect, it } from "vitest";
import { detectAnomalies, diagnose, engagementRate, experimentLift, goalPace, type PostSample } from "@/domain/analytics";
import { quoteForPlan, exceedsQuote, DEFAULT_PRICES } from "@/domain/quotes";
import type { ProductionPlan } from "@/domain/schemas";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));

function post(i: number, m: PostSample["metrics"], followers = 10000): PostSample {
  return { id: `p${i}`, platform: "instagram", format: "reel", publishedAt: day(i), metrics: m, followersAtPost: followers, durationSec: 20 };
}

describe("engagementRate", () => {
  it("uses reach as the base", () => {
    expect(engagementRate({ likes: 80, comments: 10, shares: 5, saves: 5, reach: 2000 })).toBe(5);
  });
  it("is undefined without a base", () => {
    expect(engagementRate({ likes: 3 })).toBeUndefined();
  });
});

describe("diagnose", () => {
  it("finds a hook problem when reach is fine but retention is low (benchmarks)", () => {
    const posts = Array.from({ length: 6 }, (_, i) => post(i, { reach: 6000, retention3s: 0.25, saves: 120, shares: 60, profileVisits: 150, follows: 40 }));
    const d = diagnose(posts, "views");
    expect(d.reference).toBe("benchmarks");
    expect(d.bottleneck).toBe("hook");
  });

  it("uses own history when there are enough older posts", () => {
    const older = Array.from({ length: 10 }, (_, i) => post(i, { reach: 8000, retention3s: 0.6, saves: 100, shares: 50, profileVisits: 120 }));
    const recent = Array.from({ length: 6 }, (_, i) => post(20 + i, { reach: 2500, retention3s: 0.6, saves: 30, shares: 15, profileVisits: 40 }));
    const d = diagnose([...older, ...recent], "reach");
    expect(d.reference).toBe("own_history");
    expect(d.bottleneck).toBe("distribution");
  });
});

describe("goalPace", () => {
  const goal = { kpi: "followers" as const, target: 12000, baseline: 10000, startDate: day(0), deadline: day(30) };

  it("is unknown with too little data", () => {
    expect(goalPace(goal, [{ date: day(0), value: 10000 }], day(1)).status).toBe("unknown");
  });

  it("detects behind pace on a level KPI", () => {
    const series = [0, 3, 6, 9, 12, 15].map((d) => ({ date: day(d), value: 10000 + d * 30 }));
    const r = goalPace(goal, series, day(15));
    expect(r.expected).toBeCloseTo(11000, 0);
    expect(r.actual).toBe(10450);
    expect(r.status).toBe("off_track");
    expect(r.projected!).toBeLessThan(12000);
  });

  it("detects ahead on a sum KPI", () => {
    const reachGoal = { kpi: "reach" as const, target: 30000, baseline: 0, startDate: day(0), deadline: day(30) };
    const series = Array.from({ length: 10 }, (_, i) => ({ date: day(i + 1), value: 1500 }));
    expect(goalPace(reachGoal, series, day(10)).status).toBe("ahead");
  });
});

describe("detectAnomalies", () => {
  it("flags a 2% follower drop", () => {
    const a = detectAnomalies([
      { date: day(0), followers: 10000 },
      { date: day(1), followers: 9790 },
    ]);
    expect(a[0].code).toBe("followers_drop");
  });
});

describe("experimentLift", () => {
  it("computes median lift", () => {
    const base = [post(1, { reach: 1000 }), post(2, { reach: 1200 }), post(3, { reach: 1100 })];
    const tagged = [post(4, { reach: 1650 }), post(5, { reach: 1500 })];
    expect(experimentLift(tagged, base, (p) => p.metrics.reach).lift).toBeCloseTo(0.4318, 3);
  });
});

describe("quotes", () => {
  const plan: ProductionPlan = {
    aspect: "9:16",
    durationSec: 20,
    shots: [
      { id: "s1", kind: "video", model: "video.cinematic", prompt: "p", keyframePrompt: "k", durationSec: 5, camera: "", motion: "push_in", transitionIn: "cut" },
      { id: "s2", kind: "video", model: "video.cinematic", prompt: "p", keyframePrompt: "", durationSec: 5, camera: "", motion: "push_in", transitionIn: "cut" },
    ],
    frames: [],
    voiceover: { script: "word ".repeat(200), language: "en", voiceStyle: "warm" },
    music: { prompt: "piano", instrumental: true },
    sfx: [],
    textOverlays: [],
    burnCaptions: true,
    coverAtSec: 0.5,
  };

  it("prices shots, keyframes, voice, music, X and contingency", () => {
    const q = quoteForPlan(plan, DEFAULT_PRICES, { platforms: ["instagram", "x"], xCaption: "no link" });
    const tools = q.items.map((i) => i.tool);
    expect(tools).toEqual(expect.arrayContaining(["higgsfield", "elevenlabs", "x-api", "claude", "buffer"]));
    expect(q.items.find((i) => i.note === "Keyframe s1")).toBeTruthy();
    expect(q.totalUsd).toBeGreaterThan(1);
  });

  it("charges $0.20 for X posts with links", () => {
    const q = quoteForPlan(plan, DEFAULT_PRICES, { platforms: ["x"], xCaption: "see https://a.b" });
    expect(q.items.find((i) => i.tool === "x-api")!.usd).toBe(0.2);
  });

  it("applies the 15% overrun rule", () => {
    const q = { items: [], totalUsd: 10, currency: "USD" as const, estimated: true as const };
    expect(exceedsQuote(11.4, q)).toBe(false);
    expect(exceedsQuote(11.6, q)).toBe(true);
  });
});
