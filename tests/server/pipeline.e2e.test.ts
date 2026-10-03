import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetConfigForTests } from "@/server/config";
import { closeDb, useInMemoryDbForTests, type DB } from "@/server/db/client";
import { contentItems, experiments, goals, inboxItems, jobs, kpiSnapshots, publications, scenarios } from "@/server/db/schema";
import { runDueJobs } from "@/server/jobs/worker";
import { syncCommunity } from "@/server/pipeline/community";
import { collectPostMetrics, dailyKpis } from "@/server/pipeline/measurement";
import { planScenarioJob } from "@/server/pipeline/planning";
import { advanceProduction, startProduction } from "@/server/pipeline/production";
import { publishDue, scheduleApproved } from "@/server/pipeline/publishing";
import { reviseItem } from "@/server/pipeline/revision";
import { runAnalysis } from "@/server/pipeline/strategy";
import { createClient, setGoal } from "@/server/services/clients";
import { connectDemoAccounts } from "@/server/services/connections";
import { approve, createScenario, greenlight, requestRevision } from "@/server/services/content";
import { resetStorageForTests } from "@/server/media/storage";

let db: DB;
let clientId: string;
let scenarioId: string;

beforeAll(async () => {
  process.env.DEMO_MODE = "true";
  process.env.DATA_DIR = "./data/test/e2e";
  resetConfigForTests();
  resetStorageForTests();
  db = await useInMemoryDbForTests();
  clientId = await createClient({
    name: "Luxi Capture",
    timezone: "Asia/Dubai",
    languages: ["en", "fa"],
    website: "https://luxicapture.example",
    brief: {
      positioning: "Cinematic wedding and brand films.",
      voice: "Warm, precise, quietly confident.",
      pillars: ["Behind the frame", "Before/after grade"],
      guardrails: ["No CGI or cheap effects", "Memorial work never appears in promotional posts"],
      hashtags: ["#luxicapture", "#cinematicwedding", "#filmmaking"],
      ctas: ["DM us your date"],
    },
  });
  await setGoal(clientId, { statement: "Grow Instagram to 6,000 followers", kpi: "followers", platform: "instagram", target: 6000, baseline: 4200, deadline: new Date(Date.now() + 60 * 86_400_000) });
  await connectDemoAccounts(clientId, ["instagram", "facebook", "linkedin", "x"]);
});

afterAll(async () => {
  await closeDb();
});

describe("full agent loop in demo mode", () => {
  it("plans a scenario into quoted, captioned, scheduled concepts", async () => {
    scenarioId = await createScenario({
      clientId,
      text: "Restoring a 1962 wedding film for a couple's 60th anniversary. Show the grain, the faces, the first time they see it.",
      formats: ["reel", "carousel", "story"],
      platforms: [],
      count: 3,
    });
    const queued = await db.select().from(jobs).where(eq(jobs.type, "scenario.plan"));
    expect(queued).toHaveLength(1);
    await planScenarioJob({ scenarioId });
    const [s] = await db.select().from(scenarios).where(eq(scenarios.id, scenarioId));
    expect(s.status).toBe("planned");
    expect(s.angles.length).toBeGreaterThanOrEqual(5);
    const items = await db.select().from(contentItems).where(eq(contentItems.scenarioId, scenarioId));
    expect(items).toHaveLength(3);
    for (const i of items) {
      expect(i.status).toBe("concept");
      expect(i.quote?.totalUsd).toBeTypeOf("number");
      expect(i.scheduledAt).toBeInstanceOf(Date);
      expect(i.scheduledAt!.getTime()).toBeGreaterThan(Date.now());
    }
    const reel = items.find((i) => i.format === "reel")!;
    expect(reel.platforms).toEqual(expect.arrayContaining(["instagram", "x"]));
    expect(reel.captions.instagram).toContain("#");
    expect(reel.captions.x.length).toBeLessThanOrEqual(280);
    const story = items.find((i) => i.format === "story")!;
    expect(story.platforms.every((p) => p === "instagram" || p === "facebook")).toBe(true);
  });

  it("produces a reel (ffmpeg) with per-platform aspect variants after green-light", async () => {
    const [reel] = await db.select().from(contentItems).where(eq(contentItems.format, "reel"));
    await greenlight(reel.id);
    await startProduction({ contentId: reel.id });
    await advanceProduction();
    const [done] = await db.select().from(contentItems).where(eq(contentItems.id, reel.id));
    expect(done.status).toBe("review");
    const aspects = new Set(done.media.map((m) => m.aspect));
    expect(aspects).toEqual(new Set(["9:16", "4:5"]));
    expect(done.media.find((m) => m.platform === "instagram")?.aspect).toBe("9:16");
    expect(done.media.find((m) => m.platform === "linkedin")?.aspect).toBe("4:5");
    expect(done.media.every((m) => m.url.startsWith("http"))).toBe(true);
  }, 240_000);

  it("produces a carousel with a LinkedIn PDF document", async () => {
    const [carousel] = await db.select().from(contentItems).where(eq(contentItems.format, "carousel"));
    await greenlight(carousel.id);
    await startProduction({ contentId: carousel.id });
    await advanceProduction();
    const [done] = await db.select().from(contentItems).where(eq(contentItems.id, carousel.id));
    expect(done.status).toBe("review");
    expect(done.media.filter((m) => m.kind === "image")).toHaveLength(6);
    expect(done.media.find((m) => m.kind === "pdf")?.platform).toBe("linkedin");
  }, 240_000);

  it("schedules approved content per platform and publishes when due", async () => {
    const [reel] = await db.select().from(contentItems).where(eq(contentItems.format, "reel"));
    await approve(reel.id);
    await scheduleApproved({ contentId: reel.id });
    let pubs = await db.select().from(publications).where(eq(publications.contentId, reel.id));
    expect(pubs.map((p) => p.platform).sort()).toEqual([...reel.platforms].sort());
    expect(pubs.every((p) => p.status === "scheduled")).toBe(true);
    // AI disclosure is added on direct routes, before the hashtag block on Instagram.
    const ig = pubs.find((p) => p.platform === "instagram")!;
    expect(ig.caption).toContain("AI-assisted visuals.");
    expect(ig.caption.trim().split("\n").pop()).toMatch(/^#/);

    await db.update(publications).set({ scheduledAt: new Date(Date.now() - 60_000) }).where(eq(publications.contentId, reel.id));
    const r = await publishDue();
    expect(r.published).toBe(pubs.length);
    pubs = await db.select().from(publications).where(eq(publications.contentId, reel.id));
    expect(pubs.every((p) => p.status === "published" && p.externalId?.startsWith("demo_"))).toBe(true);
    const [live] = await db.select().from(contentItems).where(eq(contentItems.id, reel.id));
    expect(live.status).toBe("live");
  });

  it("measures posts at checkpoints and rolls performance up", async () => {
    const [reel] = await db.select().from(contentItems).where(eq(contentItems.format, "reel"));
    await db.update(publications).set({ publishedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(publications.contentId, reel.id));
    const r = await collectPostMetrics();
    expect(r.measured).toBeGreaterThan(0);
    const pubs = await db.select().from(publications).where(eq(publications.contentId, reel.id));
    expect(pubs.every((p) => p.checkpoints.h24)).toBe(true);
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, reel.id));
    expect(item.performance?.reach).toBeGreaterThan(0);
    expect(item.performance?.engagementRate).toBeGreaterThan(0);
  });

  it("records daily KPIs, audience and goal pace", async () => {
    await dailyKpis();
    const kpis = await db.select().from(kpiSnapshots).where(eq(kpiSnapshots.clientId, clientId));
    expect(kpis.length).toBe(4);
    const [goal] = await db.select().from(goals).where(eq(goals.clientId, clientId));
    expect(goal.current).toBeGreaterThan(0);
  });

  it("runs the weekly analysis (goal read, experiment, re-plan)", async () => {
    const r = await runAnalysis({ clientId, mode: "weekly" });
    expect(r).toHaveProperty("reviews");
    const [goal] = await db.select().from(goals).where(eq(goals.clientId, clientId));
    expect(goal.agentRead).toBeTruthy();
    const exps = await db.select().from(experiments).where(eq(experiments.clientId, clientId));
    expect(exps.length).toBeLessThanOrEqual(1);
  });

  it("answers comments autonomously, hides spam, escalates sensitive ones", async () => {
    const [reel] = await db.select().from(contentItems).where(eq(contentItems.format, "reel"));
    await db.update(publications).set({ publishedAt: new Date(Date.now() - 14 * 3_600_000) }).where(eq(publications.contentId, reel.id));
    const r = await syncCommunity();
    expect(r.fetched).toBeGreaterThan(0);
    const inbox = await db.select().from(inboxItems).where(eq(inboxItems.clientId, clientId));
    expect(inbox.some((i) => i.status === "sent" && i.reply)).toBe(true);
    expect(inbox.some((i) => i.status === "hidden")).toBe(true);
    // Price questions are leads: answered without a quote, then flagged for a personal follow-up.
    const lead = inbox.find((i) => i.category === "lead");
    expect(lead?.status).toBe("needs_you");
    expect(lead?.repliedAt).toBeInstanceOf(Date);
    expect(lead?.reply).not.toMatch(/\$|€|AED|\d{3,}/);
    const persian = inbox.find((i) => i.text.includes("قیمت"));
    if (persian) expect(persian.language).toBe("fa");
    // A second sync does not duplicate.
    const again = await syncCommunity();
    expect(again.fetched).toBe(0);
  });

  it("revises a concept from a note", async () => {
    const [story] = await db.select().from(contentItems).where(eq(contentItems.format, "story"));
    await requestRevision(story.id, "Make the poll about the decade, and keep it under 8 words.");
    await reviseItem({ contentId: story.id });
    const [revised] = await db.select().from(contentItems).where(eq(contentItems.id, story.id));
    expect(revised.status).toBe("concept");
    expect(revised.revisionNote).toBeNull();
  });

  it("runs queued jobs through the worker registry", async () => {
    const r = await runDueJobs(30_000);
    expect(r.failed).toBe(0);
  }, 240_000);
});
