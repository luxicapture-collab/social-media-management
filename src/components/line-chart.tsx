"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { niceTicks } from "./charts";

export interface LinePoint {
  date: string;
  value: number;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: abs < 10 ? 2 : 0 });
}

const pad = { top: 16, right: 56, bottom: 26, left: 44 };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * One measure over time: the series in the accent (2px, 10% wash, end dot with a surface ring and
 * a value label), an optional on-pace path in the muted hue, hairline grid, and a crosshair that
 * snaps to the nearest date with a tooltip listing every series at that point.
 */
export function LineChart({ points, path, label, height = 220, valueLabel = "Value", pathLabel = "On-pace path" }: { points: LinePoint[]; path?: LinePoint[]; label: string; height?: number; valueLabel?: string; pathLabel?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Draw in real pixels (viewBox = rendered width) so labels keep their size on a phone.
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geo = useMemo(() => {
    const all = [...points, ...(path ?? [])];
    const ts = all.map((p) => new Date(p.date).getTime());
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const ticks = niceTicks(Math.min(...all.map((p) => p.value)), Math.max(...all.map((p) => p.value)));
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const x = (iso: string) => pad.left + ((new Date(iso).getTime() - t0) / Math.max(1, t1 - t0)) * (width - pad.left - pad.right);
    const y = (v: number) => pad.top + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * (height - pad.top - pad.bottom);
    return { ticks, x, y };
  }, [points, path, height, width]);

  if (points.length < 2) {
    return <p className="text-sm text-faint">Not enough data yet — the chart appears after two daily readings.</p>;
  }

  const line = points.map((p, i) => `${i ? "L" : "M"}${geo.x(p.date).toFixed(1)},${geo.y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${geo.x(points[points.length - 1].date).toFixed(1)},${height - pad.bottom} L${geo.x(points[0].date).toFixed(1)},${height - pad.bottom} Z`;
  const pathD = path && path.length > 1 ? path.map((p, i) => `${i ? "L" : "M"}${geo.x(p.date).toFixed(1)},${geo.y(p.value).toFixed(1)}`).join(" ") : null;
  const last = points[points.length - 1];
  const pathEnd = path?.length ? path.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a)) : null;
  const runsPast = pathEnd && new Date(pathEnd.date).getTime() > new Date(last.date).getTime() + 86_400_000;
  // Start, latest reading and — when the on-pace path runs on to a deadline — the deadline.
  const xTicks = runsPast ? [points[0], last, pathEnd] : [points[0], points[Math.floor(points.length / 2)], last];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    let dist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geo.x(p.date) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? points[hover] : null;
  const pathAt = hp && path?.length ? path.reduce((a, b) => (Math.abs(new Date(b.date).getTime() - new Date(hp.date).getTime()) < Math.abs(new Date(a.date).getTime() - new Date(hp.date).getTime()) ? b : a)) : null;

  return (
    <figure ref={wrapRef} className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title>{label}</title>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={pad.left - 8} y={geo.y(t) + 4} textAnchor="end" fontSize={11} fill="var(--faint)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((p, i) => (
          <text key={`${p.date}-${i}`} x={geo.x(p.date)} y={height - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize={11} fill="var(--faint)">
            {shortDate(p.date)}
          </text>
        ))}
        {pathD ? <path d={pathD} fill="none" stroke="var(--viz-muted)" strokeWidth={1.5} /> : null}
        <path d={area} fill="var(--viz-1)" opacity={0.1} />
        <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={geo.x(last.date)} cy={geo.y(last.value)} r={4} fill="var(--viz-1)" stroke="var(--surface)" strokeWidth={2} />
        <text x={geo.x(last.date) + 8} y={geo.y(last.value) + 4} fontSize={12} fontWeight={600} fill="var(--fg)">
          {fmt(last.value)}
        </text>
        {hp ? (
          <g>
            <line x1={geo.x(hp.date)} x2={geo.x(hp.date)} y1={pad.top} y2={height - pad.bottom} stroke="var(--viz-axis)" strokeWidth={1} />
            <circle cx={geo.x(hp.date)} cy={geo.y(hp.value)} r={4} fill="var(--viz-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      {hp ? (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${(geo.x(hp.date) / width) * 100}% - 70px), calc(100% - 150px))` }}
        >
          <div className="text-faint">{shortDate(hp.date)}</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded bg-viz-1" />
            <span className="font-semibold text-fg">{fmt(hp.value)}</span>
            <span className="text-muted">{valueLabel}</span>
          </div>
          {pathAt ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-3 rounded bg-viz-muted" />
              <span className="font-semibold text-fg">{fmt(pathAt.value)}</span>
              <span className="text-muted">{pathLabel}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {pathD ? (
        <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-viz-1" />
            {valueLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-viz-muted" />
            {pathLabel}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
