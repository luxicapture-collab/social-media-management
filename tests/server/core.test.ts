import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { decrypt, encrypt, hashPassword, hmacSha256Hex, verifyMetaSignature, verifyPassword } from "@/server/crypto";
import { closeDb, useInMemoryDbForTests, type DB } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { claimNext, completeJob, enqueue, failJob, PermanentJobError, RescheduleJob } from "@/server/jobs/queue";
import { ensureSchedules, tickSchedules } from "@/server/jobs/scheduler";
import { applyKnowledgeProposal, getKnowledge, proposeKnowledgeUpdate } from "@/server/knowledge";
import { getPrices, setSetting } from "@/server/settings";

let db: DB;

beforeAll(async () => {
  db = await useInMemoryDbForTests();
});

afterAll(async () => {
  await closeDb();
});

describe("crypto", () => {
  it("round-trips encrypted secrets", () => {
    const sealed = encrypt("EAAB-token");
    expect(sealed).not.toContain("EAAB");
    expect(decrypt(sealed)).toBe("EAAB-token");
  });

  it("verifies scrypt passwords", () => {
    const h = hashPassword("s3cret!");
    expect(verifyPassword("s3cret!", h)).toBe(true);
    expect(verifyPassword("nope", h)).toBe(false);
  });

  it("verifies Meta webhook signatures", () => {
    const body = '{"entry":[]}';
    const sig = `sha256=${hmacSha256Hex("appsecret", body)}`;
    expect(verifyMetaSignature(body, sig, "appsecret")).toBe(true);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
  });
});

describe("job queue", () => {
  it("deduplicates active jobs and claims in order", async () => {
    const a = await enqueue("test.a", { n: 1 }, { dedupeKey: "k1" });
    const b = await enqueue("test.a", { n: 2 }, { dedupeKey: "k1" });
    expect(a).toBeTypeOf("number");
    expect(b).toBeNull();

    const job = await claimNext("w1");
    expect(job?.id).toBe(a);
    expect(job?.status).toBe("running");
    await completeJob(job!.id, { ok: true });
    // Once done, the same dedupe key can be enqueued again.
    expect(await enqueue("test.a", {}, { dedupeKey: "k1" })).toBeTypeOf("number");
  });

  it("retries with backoff, stops on permanent errors, reschedules without burning attempts", async () => {
    await db.delete(jobs);
    await enqueue("test.retry", {}, { maxAttempts: 3 });
    let job = (await claimNext("w1"))!;
    await failJob(job, new Error("boom"));
    let [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("queued");
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());

    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, job.id));
    job = (await claimNext("w1"))!;
    await failJob(job, new RescheduleJob(60_000));
    [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);

    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, job.id));
    job = (await claimNext("w1"))!;
    await failJob(job, new PermanentJobError("no connection"));
    [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("dead");
  });
});

describe("scheduler", () => {
  it("fires due schedules once per slot", async () => {
    await db.delete(jobs);
    await ensureSchedules(new Date("2026-10-02T10:00:30Z"));
    const fired = await tickSchedules(new Date("2026-10-02T10:01:05Z"));
    expect(fired).toEqual(expect.arrayContaining(["publish-due", "advance-production"]));
    const again = await tickSchedules(new Date("2026-10-02T10:01:10Z"));
    expect(again).toEqual([]);
  });
});

describe("settings and knowledge", () => {
  it("merges stored prices over defaults", async () => {
    await setSetting("prices", { models: { "video.cinematic": { label: "Seedance 1080p", usdPerSecond: 0.3 } } });
    const p = await getPrices();
    expect(p.models["video.cinematic"].usdPerSecond).toBe(0.3);
    expect(p.models["image.hero"]).toBeTruthy();
  });

  it("seeds playbooks and appends approved self-updates", async () => {
    const before = await getKnowledge("platforms");
    expect(before).toContain("Instagram");
    const id = await proposeKnowledgeUpdate({ key: "platforms", summary: "X raised limit", addition: "X Premium posts may be 25,000 characters.", reason: "changelog" });
    await applyKnowledgeProposal(id);
    const after = await getKnowledge("platforms");
    expect(after).toContain("X Premium posts may be 25,000 characters.");
  });
});
