import { addLocalDays, atLocalTime, hoursBetween, localDateKey, startOfLocalDay, zonedParts } from "./time";
import type { Format, Platform } from "./types";

/**
 * Posting-slot selection. Defaults are research-backed starting points; once a client has
 * history, `learnedHours` (hours with the best median reach) take priority.
 */

export interface Slot {
  hour: number;
  minute: number;
}

/** Default high-performing local hours per platform, weekday vs weekend. */
export const DEFAULT_SLOTS: Record<Platform, { weekday: Slot[]; weekend: Slot[] }> = {
  instagram: {
    weekday: [
      { hour: 12, minute: 15 },
      { hour: 19, minute: 30 },
      { hour: 9, minute: 0 },
      { hour: 21, minute: 0 },
    ],
    weekend: [
      { hour: 11, minute: 0 },
      { hour: 19, minute: 0 },
    ],
  },
  facebook: {
    weekday: [
      { hour: 9, minute: 30 },
      { hour: 18, minute: 30 },
      { hour: 13, minute: 0 },
    ],
    weekend: [{ hour: 11, minute: 30 }],
  },
  linkedin: {
    weekday: [
      { hour: 8, minute: 15 },
      { hour: 12, minute: 0 },
      { hour: 17, minute: 15 },
    ],
    weekend: [],
  },
  x: {
    weekday: [
      { hour: 8, minute: 45 },
      { hour: 12, minute: 30 },
      { hour: 17, minute: 30 },
    ],
    weekend: [{ hour: 10, minute: 0 }],
  },
};

/** Story beats spread through the day. */
export const STORY_SLOTS: Slot[] = [
  { hour: 8, minute: 30 },
  { hour: 12, minute: 45 },
  { hour: 18, minute: 0 },
  { hour: 21, minute: 15 },
];

export interface ExistingPost {
  at: Date;
  platform: Platform;
  format: Format;
}

export interface SlotRequest {
  platform: Platform;
  format: Format;
  tz: string;
  now: Date;
  windowStart?: Date;
  windowEnd?: Date;
  existing: ExistingPost[];
  /** Local hours ranked best-first, learned from the client's own data. */
  learnedHours?: number[];
  /** Earliest lead time from now, in minutes (production/approval buffer). */
  minLeadMinutes?: number;
}

function isFeed(format: Format): boolean {
  return format === "post" || format === "carousel" || format === "reel";
}

/** Per-account rules: max one reel per day, feed posts ≥4h apart, stories ≥2h apart. */
export function violatesRules(candidate: Date, req: SlotRequest): string | null {
  const samePlatform = req.existing.filter((e) => e.platform === req.platform);
  if (req.format === "reel") {
    const day = localDateKey(candidate, req.tz);
    if (samePlatform.some((e) => e.format === "reel" && localDateKey(e.at, req.tz) === day)) {
      return "already a reel that day";
    }
  }
  if (isFeed(req.format)) {
    if (samePlatform.some((e) => isFeed(e.format) && hoursBetween(e.at, candidate) < 4)) {
      return "another feed post within 4 hours";
    }
  }
  if (req.format === "story") {
    if (samePlatform.some((e) => e.format === "story" && hoursBetween(e.at, candidate) < 2)) {
      return "another story within 2 hours";
    }
  }
  return null;
}

function slotsForDay(req: SlotRequest, day: Date): Slot[] {
  if (req.format === "story") return STORY_SLOTS;
  const weekday = zonedParts(day, req.tz).weekday;
  const isWeekend = weekday === 0 || weekday === 6;
  const defaults = isWeekend ? DEFAULT_SLOTS[req.platform].weekend : DEFAULT_SLOTS[req.platform].weekday;
  if (req.learnedHours?.length) {
    const learned = req.learnedHours.map((h) => ({ hour: h, minute: 0 }));
    // Learned hours first, defaults after (deduplicated by hour).
    return [...learned, ...defaults.filter((d) => !req.learnedHours!.includes(d.hour))];
  }
  return defaults;
}

/**
 * Find the best slot inside [windowStart, windowEnd]; if none fits, look up to 7 days past the
 * window. Returns null only when nothing in 14 days satisfies the rules.
 */
export function pickSlot(req: SlotRequest): Date | null {
  const lead = (req.minLeadMinutes ?? 30) * 60_000;
  const earliest = new Date(Math.max(req.now.getTime() + lead, req.windowStart?.getTime() ?? 0));
  const windowEnd = req.windowEnd ?? addLocalDays(earliest, 7, req.tz);
  const hardEnd = addLocalDays(windowEnd, 7, req.tz);

  let day = startOfLocalDay(earliest, req.tz);
  for (let i = 0; i < 21 && day.getTime() <= hardEnd.getTime(); i++) {
    for (const slot of slotsForDay(req, day)) {
      const candidate = atLocalTime(day, slot.hour, slot.minute, req.tz);
      if (candidate.getTime() < earliest.getTime()) continue;
      if (candidate.getTime() > hardEnd.getTime()) continue;
      if (violatesRules(candidate, req)) continue;
      return candidate;
    }
    day = addLocalDays(day, 1, req.tz);
  }
  return null;
}

/**
 * Keep a requested time if it is in the future and legal; otherwise move it to the next best
 * slot within 48 hours (falling back to the general search). Returns the time and a note.
 */
export function normalizeScheduledAt(requested: Date | null, req: SlotRequest): { at: Date | null; note?: string } {
  const lead = (req.minLeadMinutes ?? 15) * 60_000;
  if (requested && requested.getTime() >= req.now.getTime() + lead) {
    const why = violatesRules(requested, req);
    if (!why) return { at: requested };
    const moved = pickSlot({ ...req, windowStart: requested, windowEnd: new Date(requested.getTime() + 48 * 3_600_000) });
    return { at: moved, note: `Moved from the requested time (${why}).` };
  }
  const moved = pickSlot({ ...req, windowStart: req.now, windowEnd: new Date(req.now.getTime() + 48 * 3_600_000) });
  return {
    at: moved,
    note: requested ? "The requested time had passed; took the next best slot within 48 hours." : undefined,
  };
}

/** Rank local hours by median reach from a client's published history. */
export function learnBestHours(history: Array<{ at: Date; reach: number }>, tz: string, minSamples = 2): number[] {
  const byHour = new Map<number, number[]>();
  for (const h of history) {
    const hour = zonedParts(h.at, tz).hour;
    byHour.set(hour, [...(byHour.get(hour) ?? []), h.reach]);
  }
  const ranked = [...byHour.entries()]
    .filter(([, v]) => v.length >= minSamples)
    .map(([hour, v]) => {
      const s = [...v].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      return { hour, median };
    })
    .sort((a, b) => b.median - a.median);
  return ranked.slice(0, 4).map((r) => r.hour);
}
