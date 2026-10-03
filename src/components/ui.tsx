import clsx from "clsx";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ContentStatus, Format, PaceStatus, Platform } from "@/domain/types";
import { FORMAT_LABEL, PLATFORM_LABEL } from "@/domain/types";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h-display text-2xl sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const FORMAT_CLASS: Record<Format, string> = {
  reel: "text-reel border-reel/40",
  story: "text-story border-story/40",
  post: "text-post border-post/40",
  carousel: "text-carousel border-carousel/40",
};

export function FormatBadge({ format }: { format: Format }) {
  return (
    <span className={clsx("badge", FORMAT_CLASS[format])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {FORMAT_LABEL[format]}
    </span>
  );
}

export function PlatformGlyph({ platform, className }: { platform: Platform; className?: string }) {
  const common = { className: clsx("h-3.5 w-3.5", className), viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true } as const;
  switch (platform) {
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8a0 0 0 0 1 0 0Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      );
  }
}

export function PlatformChips({ platforms }: { platforms: Platform[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {platforms.map((p) => (
        <span key={p} className="badge" title={PLATFORM_LABEL[p]}>
          <PlatformGlyph platform={p} />
          <span className="hidden sm:inline">{PLATFORM_LABEL[p]}</span>
        </span>
      ))}
    </span>
  );
}

const STATUS_STYLE: Record<ContentStatus, { label: string; cls: string }> = {
  concept: { label: "Concept · needs green-light", cls: "text-accent border-accent/40" },
  greenlit: { label: "Green-lit", cls: "text-info border-info/40" },
  producing: { label: "Producing", cls: "text-info border-info/40" },
  review: { label: "Cut ready · review", cls: "text-accent border-accent/40" },
  approved: { label: "Approved", cls: "text-success border-success/40" },
  scheduled: { label: "Scheduled", cls: "text-success border-success/40" },
  live: { label: "Live", cls: "text-success border-success/40" },
  analyzed: { label: "Analyzed", cls: "text-muted" },
  revise: { label: "Revising", cls: "text-info border-info/40" },
  dropped: { label: "Dropped", cls: "text-faint" },
  failed: { label: "Failed", cls: "text-danger border-danger/40" },
};

export function StatusPill({ status }: { status: ContentStatus }) {
  const s = STATUS_STYLE[status];
  return <span className={clsx("badge", s.cls)}>{s.label}</span>;
}

/** Status colors always ship with an icon and a label. */
export function PacePill({ pace }: { pace: PaceStatus }) {
  const map: Record<PaceStatus, { label: string; cls: string; Icon: typeof TrendingUp }> = {
    ahead: { label: "Ahead of pace", cls: "text-success border-success/40", Icon: TrendingUp },
    on_track: { label: "On track", cls: "text-success border-success/40", Icon: CheckCircle2 },
    behind: { label: "Behind pace", cls: "text-warning border-warning/40", Icon: TrendingDown },
    off_track: { label: "Off track", cls: "text-danger border-danger/40", Icon: AlertTriangle },
    unknown: { label: "Gathering data", cls: "text-muted", Icon: CircleDashed },
  };
  const m = map[pace];
  return (
    <span className={clsx("badge", m.cls)}>
      <m.Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </span>
  );
}

export function ImportanceTag({ importance }: { importance: "high" | "medium" | "info" }) {
  const map = {
    high: { label: "High", cls: "text-danger border-danger/40", Icon: AlertTriangle },
    medium: { label: "Medium", cls: "text-warning border-warning/40", Icon: Clock },
    info: { label: "Info", cls: "text-muted", Icon: CircleDashed },
  } as const;
  const m = map[importance];
  return (
    <span className={clsx("badge", m.cls)}>
      <m.Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card card-pad flex flex-col items-start gap-2 border-dashed">
      <p className="font-medium">{title}</p>
      {body ? <p className="text-sm text-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const inner = (
    <div className="card card-pad h-full">
      <p className="text-xs text-muted">{label}</p>
      <p className="kpi mt-1" style={{ fontVariantNumeric: "normal" }}>
        {value}
      </p>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-transform hover:-translate-y-0.5">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function compact(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(digits).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(digits).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: abs < 10 ? 2 : 0 });
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

export function TextDir({ text, className }: { text: string; className?: string }) {
  return (
    <span dir="auto" className={clsx("whitespace-pre-wrap", className)}>
      {text}
    </span>
  );
}

/** Local media is served from /api/media; strip the configured origin so it also works over a LAN IP or tunnel. */
export function mediaSrc(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.startsWith("/api/media/") ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}

export function timeAgo(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return "–";
  const d = typeof date === "string" ? new Date(date) : date;
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const v = a < 60 ? "just now" : a < 3600 ? `${Math.floor(a / 60)} min` : a < 86_400 ? `${Math.floor(a / 3600)} h` : `${Math.floor(a / 86_400)} d`;
  if (v === "just now") return v;
  return future ? `in ${v}` : `${v} ago`;
}

export function SectionCard({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("card card-pad", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title mb-0">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
