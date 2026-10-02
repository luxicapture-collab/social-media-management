/**
 * Time-zone helpers built on Intl (no dependencies). All storage is UTC; scheduling
 * decisions are made in the client's IANA time zone.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Offset of `tz` from UTC at `date`, in minutes (e.g. +210 for Asia/Tehran). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock time in `tz` to the UTC instant. Handles DST gaps by rolling forward. */
export function zonedToUtc(
  local: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  tz: string,
): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0, local.second ?? 0);
  let ts = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  // Second pass corrects for offset changes between the guess and the result (DST boundaries).
  ts = guess - tzOffsetMinutes(new Date(ts), tz) * 60000;
  return new Date(ts);
}

export function localDateKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function startOfLocalDay(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, tz);
}

export function addLocalDays(date: Date, days: number, tz: string): Date {
  const p = zonedParts(date, tz);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: p.hour,
      minute: p.minute,
      second: p.second,
    },
    tz,
  );
}

export function atLocalTime(dayInTz: Date, hour: number, minute: number, tz: string): Date {
  const p = zonedParts(dayInTz, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day, hour, minute }, tz);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO 8601 with the zone's offset, e.g. 2026-10-05T19:00:00+03:30. */
export function isoWithOffset(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  const off = tzOffsetMinutes(date, tz);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Local wall-clock string without offset (YYYY-MM-DDTHH:mm:ss), as some APIs want with a separate timezone field. */
export function localDateTimeString(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function formatLocal(date: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...opts,
  }).format(date);
}

export function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}
