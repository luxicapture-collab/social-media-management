import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { FormatBadge, PageHeader, PlatformGlyph, StatusPill } from "@/components/ui";
import { addLocalDays, formatLocal, localDateKey, startOfLocalDay, zonedParts, zonedToUtc } from "@/domain/time";
import { FORMATS, type Format } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { calendarData, clientsList } from "@/server/queries";

export const metadata = { title: "Calendar" };

const DOT: Record<Format, string> = { reel: "bg-reel", story: "bg-story", post: "bg-post", carousel: "bg-carousel" };
const PLURAL: Record<Format, string> = { reel: "Reels", story: "Stories", post: "Posts", carousel: "Carousels" };

function weekStart(date: Date, tz: string): Date {
  const day = startOfLocalDay(date, tz);
  const p = zonedParts(day, tz);
  const mondayIndex = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
  return addLocalDays(day, -mondayIndex, tz);
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string; client?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const tz = config().agencyTimezone;
  const anchor = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? zonedToUtc({ year: +sp.week.slice(0, 4), month: +sp.week.slice(5, 7), day: +sp.week.slice(8, 10), hour: 12, minute: 0 }, tz) : new Date();
  const start = weekStart(anchor, tz);
  const days = Array.from({ length: 7 }, (_, i) => addLocalDays(start, i, tz));
  const end = addLocalDays(start, 7, tz);
  const [items, clients] = await Promise.all([calendarData(start, end, sp.client || undefined), clientsList()]);
  const byDay = new Map<string, typeof items>();
  for (const it of items) {
    if (!it.scheduledAt) continue;
    const k = localDateKey(it.scheduledAt, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const todayKey = localDateKey(new Date(), tz);
  const prev = localDateKey(addLocalDays(start, -7, tz), tz);
  const next = localDateKey(addLocalDays(start, 7, tz), tz);
  const q = (week: string) => `/calendar?week=${week}${sp.client ? `&client=${sp.client}` : ""}`;
  const counts = FORMATS.map((f) => [f, items.filter((i) => i.format === f).length] as const);

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={`Week of ${formatLocal(start, tz, { weekday: undefined, hour: undefined, minute: undefined, year: "numeric" })} · times in ${tz}`}
        actions={
          <>
            <form className="flex gap-2" action="/calendar">
              <input type="hidden" name="week" value={localDateKey(start, tz)} />
              <select name="client" defaultValue={sp.client ?? ""} className="input w-auto py-1.5" aria-label="Client">
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" type="submit">
                Filter
              </button>
            </form>
            <div className="flex gap-1">
              <Link href={q(prev)} className="btn btn-sm" aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Link>
              <Link href={q(todayKey)} className="btn btn-sm">
                This week
              </Link>
              <Link href={q(next)} className="btn btn-sm" aria-label="Next week">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted">
        {counts.map(([f, n]) => (
          <span key={f} className="flex items-center gap-1.5">
            <span className={clsx("h-2 w-2 rounded-full", DOT[f])} aria-hidden />
            {PLURAL[f]} · {n}
          </span>
        ))}
      </div>

      {/* Desktop: week grid */}
      <div className="hidden grid-cols-7 gap-2 md:grid">
        {days.map((day) => {
          const key = localDateKey(day, tz);
          const list = byDay.get(key) ?? [];
          return (
            <div key={key} className={clsx("card min-h-64 p-2", key === todayKey && "border-accent/60")}>
              <p className={clsx("mb-2 px-1 text-xs", key === todayKey ? "font-semibold text-accent" : "text-muted")}>{formatLocal(day, tz, { hour: undefined, minute: undefined, month: undefined })}</p>
              <ul className="space-y-1.5">
                {list.map((it) => (
                  <li key={it.id}>
                    <Link href={`/content/${it.id}`} className={clsx("block rounded-lg border border-border bg-surface-2 p-1.5 text-xs hover:border-accent/50", ["concept", "review"].includes(it.status) && "border-dashed")}>
                      <span className="flex items-center gap-1 text-muted tabular-nums">
                        <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", DOT[it.format])} aria-hidden />
                        {formatLocal(it.scheduledAt!, tz, { weekday: undefined, day: undefined, month: undefined })}
                        <span className="ml-auto flex gap-0.5">
                          {it.platforms.map((p) => (
                            <PlatformGlyph key={p} platform={p} className="h-3 w-3" />
                          ))}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 leading-snug text-fg">{it.title}</span>
                      {!sp.client ? <span className="block truncate text-[10px] text-faint">{it.client}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Phone: agenda */}
      <div className="space-y-4 md:hidden">
        {days.map((day) => {
          const key = localDateKey(day, tz);
          const list = byDay.get(key) ?? [];
          return (
            <section key={key}>
              <h2 className={clsx("mb-1.5 text-xs font-semibold tracking-wide uppercase", key === todayKey ? "text-accent" : "text-muted")}>{formatLocal(day, tz, { weekday: "long", hour: undefined, minute: undefined })}</h2>
              {list.length ? (
                <ul className="card divide-y divide-border">
                  {list.map((it) => (
                    <li key={it.id}>
                      <Link href={`/content/${it.id}`} className="flex items-start gap-3 px-3 py-2.5">
                        <span className="w-11 shrink-0 pt-0.5 text-xs text-muted tabular-nums">{formatLocal(it.scheduledAt!, tz, { weekday: undefined, day: undefined, month: undefined })}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{it.title}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <FormatBadge format={it.format} />
                            <StatusPill status={it.status} />
                            {!sp.client ? <span className="text-[11px] text-faint">{it.client}</span> : null}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-xs text-faint">Nothing planned</p>
              )}
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-faint">Dashed cards are still waiting on your green-light or approval.</p>
    </div>
  );
}
