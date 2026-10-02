import { describe, expect, it } from "vitest";
import { learnBestHours, normalizeScheduledAt, pickSlot, violatesRules } from "@/domain/scheduling";
import { zonedParts } from "@/domain/time";

const tz = "Asia/Dubai";
const now = new Date("2026-10-05T04:00:00Z"); // Monday 08:00 in Dubai

describe("pickSlot", () => {
  it("picks the first default weekday slot after the lead time", () => {
    const at = pickSlot({ platform: "instagram", format: "reel", tz, now, existing: [] })!;
    const p = zonedParts(at, tz);
    expect(p.weekday).toBe(1);
    expect(`${p.hour}:${p.minute}`).toBe("12:15");
  });

  it("allows only one reel per day per account", () => {
    const first = pickSlot({ platform: "instagram", format: "reel", tz, now, existing: [] })!;
    const second = pickSlot({ platform: "instagram", format: "reel", tz, now, existing: [{ at: first, platform: "instagram", format: "reel" }] })!;
    expect(zonedParts(second, tz).day).toBe(zonedParts(first, tz).day + 1);
  });

  it("keeps feed posts 4 hours apart", () => {
    const reel = new Date("2026-10-05T08:15:00Z"); // 12:15 Dubai
    const why = violatesRules(new Date("2026-10-05T10:00:00Z"), { platform: "instagram", format: "post", tz, now, existing: [{ at: reel, platform: "instagram", format: "reel" }] });
    expect(why).toMatch(/4 hours/);
  });

  it("skips weekends for LinkedIn", () => {
    const friday = new Date("2026-10-09T15:00:00Z"); // Friday 19:00 Dubai, after the last slot
    const at = pickSlot({ platform: "linkedin", format: "post", tz, now: friday, existing: [] })!;
    expect(zonedParts(at, tz).weekday).toBe(1);
  });

  it("prefers learned hours", () => {
    const at = pickSlot({ platform: "instagram", format: "post", tz, now, existing: [], learnedHours: [17] })!;
    expect(zonedParts(at, tz).hour).toBe(17);
  });
});

describe("normalizeScheduledAt", () => {
  it("moves a past time to the next slot within 48h with a note", () => {
    const r = normalizeScheduledAt(new Date("2026-10-01T10:00:00Z"), { platform: "instagram", format: "reel", tz, now, existing: [] });
    expect(r.at!.getTime()).toBeGreaterThan(now.getTime());
    expect(r.note).toMatch(/passed/);
  });

  it("keeps a valid future time", () => {
    const want = new Date("2026-10-06T15:30:00Z");
    expect(normalizeScheduledAt(want, { platform: "instagram", format: "reel", tz, now, existing: [] }).at).toEqual(want);
  });
});

describe("learnBestHours", () => {
  it("ranks hours by median reach", () => {
    const h = (iso: string, reach: number) => ({ at: new Date(iso), reach });
    const ranked = learnBestHours(
      [h("2026-09-01T15:00:00Z", 900), h("2026-09-02T15:00:00Z", 1100), h("2026-09-01T05:00:00Z", 300), h("2026-09-03T05:00:00Z", 200)],
      tz,
    );
    expect(ranked).toEqual([19, 9]);
  });
});
