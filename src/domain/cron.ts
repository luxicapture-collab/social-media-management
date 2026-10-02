import { zonedParts, zonedToUtc } from "./time";

/**
 * Minimal 5-field cron (minute hour day-of-month month day-of-week) with time-zone support.
 * Supports *, numbers, ranges (a-b), steps (*\/n, a-b/n) and lists (a,b,c).
 * As in Vixie cron, when both day-of-month and day-of-week are restricted, either may match.
 */

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step "${part}"`);
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      start = a;
      end = b;
    } else {
      start = Number(rangePart);
      end = stepPart ? max : start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid cron field "${field}" (allowed ${min}-${max})`);
    }
    for (let v = start; v <= end; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron expression must have 5 fields: "${expr}"`);
  const [m, h, dom, mon, dow] = fields;
  const daysOfWeek = parseField(dow.replace(/\b7\b/g, "0"), 0, 6);
  return {
    minutes: parseField(m, 0, 59),
    hours: parseField(h, 0, 23),
    daysOfMonth: parseField(dom, 1, 31),
    months: parseField(mon, 1, 12),
    daysOfWeek,
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
}

function dayMatches(spec: CronSpec, day: number, weekday: number): boolean {
  if (spec.domRestricted && spec.dowRestricted) return spec.daysOfMonth.has(day) || spec.daysOfWeek.has(weekday);
  if (spec.domRestricted) return spec.daysOfMonth.has(day);
  if (spec.dowRestricted) return spec.daysOfWeek.has(weekday);
  return true;
}

/** Next instant strictly after `after` that matches `expr` in time zone `tz`. */
export function nextRun(expr: string, after: Date, tz = "UTC"): Date {
  const spec = parseCron(expr);
  // Walk local minutes; bounded to ~1 year of search.
  let cursor = new Date(Math.floor(after.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 366 * 24 * 60; ) {
    const p = zonedParts(cursor, tz);
    if (!spec.months.has(p.month) || !dayMatches(spec, p.day, p.weekday)) {
      // Jump to next local midnight.
      const nextDay = zonedToUtc({ year: p.year, month: p.month, day: p.day + 1, hour: 0, minute: 0 }, tz);
      i += Math.max(1, Math.round((nextDay.getTime() - cursor.getTime()) / 60000));
      cursor = nextDay;
      continue;
    }
    if (!spec.hours.has(p.hour)) {
      const nextHour = new Date(cursor.getTime() + (60 - p.minute) * 60000);
      i += 60 - p.minute;
      cursor = nextHour;
      continue;
    }
    if (spec.minutes.has(p.minute)) return cursor;
    cursor = new Date(cursor.getTime() + 60000);
    i += 1;
  }
  throw new Error(`No run time found within a year for "${expr}"`);
}

export function matches(expr: string, at: Date, tz = "UTC"): boolean {
  const spec = parseCron(expr);
  const p = zonedParts(at, tz);
  return spec.minutes.has(p.minute) && spec.hours.has(p.hour) && spec.months.has(p.month) && dayMatches(spec, p.day, p.weekday);
}
