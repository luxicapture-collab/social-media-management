import clsx from "clsx";
import { compact } from "./ui";

/** Round tick values (0 / 1,000 / 2,000…) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/** Tiny trend line: history in the de-emphasis hue, the latest point in the accent. */
export function Sparkline({ values, width = 96, height = 28, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <span className="text-xs text-faint">–</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8)] as const);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--viz-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--viz-1)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

export interface BarRow {
  label: string;
  value: number;
  /** Optional preformatted value (e.g. "42%"). */
  display?: string;
}

/** Horizontal bars, one hue, value at the tip. Hover shows the exact value too. */
export function BarList({ rows, max, title }: { rows: BarRow[]; max?: number; title: string }) {
  if (!rows.length) return <p className="text-sm text-faint">No data reported.</p>;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2" aria-label={title}>
      {rows.map((r) => {
        const pct = Math.max(1.5, (r.value / top) * 100);
        const display = r.display ?? compact(r.value);
        return (
          <li key={r.label} className="group grid grid-cols-[minmax(0,7.5rem)_1fr] items-center gap-3 text-sm" title={`${r.label}: ${display}`}>
            <span className="truncate text-muted" dir="auto">
              {r.label}
            </span>
            <span className="flex items-center gap-2">
              <span className="relative h-2.5 flex-1">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-viz-1 transition-[filter] group-hover:brightness-110"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="w-12 text-right text-xs text-fg tabular-nums">{display}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Progress toward a target. The fill carries the pace severity; the track is a lighter step of the same hue. */
export function Meter({ value, target, baseline, pace, unit }: { value: number | null; target: number; baseline: number | null; pace: string; unit?: string }) {
  const base = baseline ?? 0;
  const span = target - base || 1;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, ((value - base) / span) * 100));
  const fill = pace === "off_track" ? "bg-danger" : pace === "behind" ? "bg-warning" : "bg-viz-1";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-fg">
          <span className="text-lg font-semibold">{compact(value)}</span>
          <span className="text-muted">
            {" "}
            / {compact(target)} {unit}
          </span>
        </span>
        <span className="text-xs text-muted tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="mt-2 h-2.5 w-full rounded-full bg-viz-track" role="meter" aria-valuemin={base} aria-valuemax={target} aria-valuenow={value ?? base} aria-label="Goal progress">
        <div className={clsx("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
