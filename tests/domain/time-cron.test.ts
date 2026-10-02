import { describe, expect, it } from "vitest";
import { matches, nextRun, parseCron } from "@/domain/cron";
import { isoWithOffset, localDateKey, tzOffsetMinutes, zonedParts, zonedToUtc } from "@/domain/time";

describe("time zones", () => {
  it("converts wall-clock time in a half-hour zone (Asia/Tehran, UTC+3:30)", () => {
    const utc = zonedToUtc({ year: 2026, month: 10, day: 5, hour: 19, minute: 0 }, "Asia/Tehran");
    expect(utc.toISOString()).toBe("2026-10-05T15:30:00.000Z");
    expect(isoWithOffset(utc, "Asia/Tehran")).toBe("2026-10-05T19:00:00+03:30");
  });

  it("handles DST in Europe/London", () => {
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-12-01T12:00:00Z"), "Europe/London")).toBe(0);
  });

  it("formats local date keys", () => {
    const d = new Date("2026-10-05T22:30:00Z");
    expect(localDateKey(d, "Asia/Dubai")).toBe("2026-10-06");
    expect(zonedParts(d, "UTC").hour).toBe(22);
  });
});

describe("cron", () => {
  it("parses fields", () => {
    const spec = parseCron("*/15 6-8 * * 1,3");
    expect([...spec.minutes]).toEqual([0, 15, 30, 45]);
    expect([...spec.hours]).toEqual([6, 7, 8]);
    expect([...spec.daysOfWeek]).toEqual([1, 3]);
  });

  it("finds the next minute", () => {
    expect(nextRun("* * * * *", new Date("2026-10-02T10:00:30Z")).toISOString()).toBe("2026-10-02T10:01:00.000Z");
  });

  it("finds a weekly slot in a time zone", () => {
    // Mondays 08:00 Asia/Dubai (UTC+4) after Friday 2026-10-02.
    expect(nextRun("0 8 * * 1", new Date("2026-10-02T10:00:00Z"), "Asia/Dubai").toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });

  it("handles day-of-month OR day-of-week", () => {
    const n = nextRun("0 9 1 * 5", new Date("2026-10-02T10:00:00Z"));
    // Next Friday (Oct 9) comes before the 1st of November.
    expect(n.toISOString()).toBe("2026-10-09T09:00:00.000Z");
    expect(matches("0 9 1 * 5", new Date("2026-11-01T09:00:00Z"))).toBe(true);
  });

  it("rejects bad expressions", () => {
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("* * *")).toThrow();
  });
});
