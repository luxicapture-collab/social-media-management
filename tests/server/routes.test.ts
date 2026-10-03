import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { hmacSha256Hex } from "@/server/crypto";
import { closeDb, useInMemoryDbForTests, type DB } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { resetStorageForTests, storage } from "@/server/media/storage";
import * as media from "@/app/api/media/[...key]/route";
import * as cron from "@/app/api/cron/tick/route";
import * as metaHook from "@/app/api/webhooks/meta/route";

let db: DB;
const KEY = ["clients", "c1", "item1", "final-9x16-abc.mp4"];
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

function mediaGet(range?: string, key = KEY) {
  const req = new NextRequest(`http://localhost/api/media/${key.join("/")}`, { headers: range ? { range } : {} });
  return media.GET(req, { params: Promise.resolve({ key }) });
}

beforeAll(async () => {
  process.env.DATA_DIR = "./data/test/routes";
  process.env.STORAGE_DRIVER = "local";
  process.env.CRON_SECRET = "cron-secret-for-tests";
  process.env.META_APP_SECRET = "meta-app-secret";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-me";
  resetConfigForTests();
  resetStorageForTests();
  db = await useInMemoryDbForTests();
  await storage().put(KEY.join("/"), bytes, "video/mp4");
});

afterAll(async () => {
  delete process.env.CRON_SECRET;
  delete process.env.META_APP_SECRET;
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
  resetConfigForTests();
  await closeDb();
});

describe("media route", () => {
  it("serves the whole file with type and length", async () => {
    const res = await mediaGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("serves byte ranges, including suffix ranges", async () => {
    const res = await mediaGet("bytes=10-19");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(10, 20))).toBe(true);

    const tail = await mediaGet("bytes=-5");
    expect(tail.headers.get("content-range")).toBe("bytes 995-999/1000");
    expect(Buffer.from(await tail.arrayBuffer()).equals(bytes.subarray(995))).toBe(true);

    const open = await mediaGet("bytes=990-");
    expect(open.headers.get("content-length")).toBe("10");
  });

  it("rejects unsatisfiable ranges, traversal and unknown keys", async () => {
    expect((await mediaGet("bytes=5000-")).status).toBe(416);
    expect((await mediaGet(undefined, ["..", "..", "etc", "passwd"])).status).toBe(400);
    expect((await mediaGet(undefined, ["clients", "nope.mp4"])).status).toBe(404);
  });

  it("answers HEAD without a body", async () => {
    const req = new NextRequest(`http://localhost/api/media/${KEY.join("/")}`, { method: "HEAD" });
    const res = await media.HEAD(req, { params: Promise.resolve({ key: KEY }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("1000");
    expect(res.body).toBeNull();
  });

  it("stops reading cleanly when the client cancels mid-stream", async () => {
    const res = await mediaGet();
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await expect(reader.cancel()).resolves.toBeUndefined();
  });
});

describe("cron tick route", () => {
  it("requires the shared secret", async () => {
    const res = await cron.GET(new NextRequest("http://localhost/api/cron/tick"));
    expect(res.status).toBe(401);
    const wrong = await cron.GET(new NextRequest("http://localhost/api/cron/tick", { headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
  });

  it("runs a worker tick with the bearer secret", async () => {
    const res = await cron.GET(new NextRequest("http://localhost/api/cron/tick?budgetMs=5000", { headers: { authorization: "Bearer cron-secret-for-tests" } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; fired: string[] };
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.fired)).toBe(true);
  });
});

describe("Meta webhook route", () => {
  it("completes the verification handshake only with the right token", async () => {
    const ok = await metaHook.GET(new NextRequest("http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await metaHook.GET(new NextRequest("http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"));
    expect(bad.status).toBe(403);
  });

  it("rejects unsigned events and queues a community sync for signed ones", async () => {
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "1", changes: [{ field: "comments" }] }] });
    const unsigned = await metaHook.POST(new NextRequest("http://localhost/api/webhooks/meta", { method: "POST", body }));
    expect(unsigned.status).toBe(401);
    const signed = await metaHook.POST(
      new NextRequest("http://localhost/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${hmacSha256Hex("meta-app-secret", body)}` } }),
    );
    expect(signed.status).toBe(200);
    expect(await db.select().from(jobs).where(eq(jobs.type, "community.sync"))).toHaveLength(1);
  });
});
