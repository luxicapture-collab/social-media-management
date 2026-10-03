import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetConfigForTests } from "@/server/config";
import { closeDb, useInMemoryDbForTests, type DB } from "@/server/db/client";
import { clients, contentItems, goals, inboxItems, jobs, kpiSnapshots, publications } from "@/server/db/schema";
import { seedDemo } from "@/server/demo/seed";
import { resetStorageForTests } from "@/server/media/storage";
import { demoAdapter } from "@/server/platforms/demo";

let db: DB;

beforeAll(async () => {
  process.env.DEMO_MODE = "true";
  process.env.DATA_DIR = "./data/test/seed";
  resetConfigForTests();
  resetStorageForTests();
  db = await useInMemoryDbForTests();
});

afterAll(async () => {
  await closeDb();
});

describe("demo account growth", () => {
  it("starts at the connected follower count and grows from there", async () => {
    const day = Math.floor(Date.now() / 86_400_000);
    const conn = { id: "c1", platform: "instagram", accountId: "a", accessToken: "demo", meta: { followers: 4200, anchorDay: day } } as never;
    const adapter = demoAdapter("instagram");
    const today = await adapter.accountMetrics(conn, new Date(day * 86_400_000), new Date((day + 1) * 86_400_000));
    const monthAgo = await adapter.accountMetrics(conn, new Date((day - 30) * 86_400_000), new Date((day - 29) * 86_400_000));
    expect(today.followers).toBe(4200);
    expect(monthAgo.followers!).toBeLessThan(4200);
    expect(4200 - monthAgo.followers!).toBeGreaterThanOrEqual(90);
  });
});

describe("seedDemo", () => {
  it("loads two sample clients with history, goals, posts and a planned scenario", async () => {
    const r = await seedDemo();
    expect(r.seeded).toBe(true);
    expect(await db.select().from(clients)).toHaveLength(2);

    const [luxi, aurum] = r.clientIds;
    const luxiKpis = await db.select().from(kpiSnapshots).where(eq(kpiSnapshots.clientId, luxi));
    expect(luxiKpis).toHaveLength(45 * 4);

    const luxiGoal = (await db.select().from(goals).where(eq(goals.clientId, luxi)))[0];
    expect(luxiGoal.status).toBe("active");
    expect(luxiGoal.pace).toBe("behind");
    expect(luxiGoal.current).toBeGreaterThan(0);
    const aurumGoal = (await db.select().from(goals).where(eq(goals.clientId, aurum)))[0];
    expect(aurumGoal.pace).toBe("ahead");

    const published = await db.select().from(publications).where(eq(publications.status, "published"));
    expect(published.length).toBeGreaterThan(20);
    expect(published.every((p) => p.metrics && (p.metrics.reach ?? 0) > 0)).toBe(true);

    const items = await db.select().from(contentItems).where(eq(contentItems.clientId, luxi));
    expect(items.some((i) => i.status === "greenlit")).toBe(true);
    expect(items.filter((i) => i.status === "concept").length).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(jobs).where(eq(jobs.type, "content.produce"))).toHaveLength(1);

    // Comments on the recent sample posts were triaged by the community agent.
    expect((await db.select().from(inboxItems)).length).toBeGreaterThan(0);
  });

  it("does nothing once clients exist", async () => {
    expect((await seedDemo()).seeded).toBe(false);
  });
});
