import { daysBetween } from "./time";
import type { Bottleneck, Format, GoalKpi, PaceStatus, Platform, PostMetrics } from "./types";

/** Engagement rate = (likes + comments + shares + saves) ÷ reach × 100. Falls back to views, then impressions. */
export function engagementRate(m: PostMetrics): number | undefined {
  const interactions = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
  const base = m.reach ?? m.views ?? m.impressions;
  if (!base || base <= 0) return undefined;
  return (interactions / base) * 100;
}

export function median(values: number[]): number | undefined {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values: number[]): number | undefined {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return undefined;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export interface PostSample {
  id: string;
  platform: Platform;
  format: Format;
  publishedAt: Date;
  metrics: PostMetrics;
  followersAtPost?: number;
  durationSec?: number;
}

/** Funnel ratios for one post. Each stage is undefined when the platform didn't report its inputs. */
export interface Funnel {
  /** Reach relative to followers: how far the algorithm carried it. */
  distribution?: number;
  /** Share of viewers still watching at 3s (or avg watch ÷ duration). */
  hook?: number;
  /** (saves + shares) ÷ reach. */
  resonance?: number;
  /** (profile visits + clicks + follows) ÷ reach. */
  conversion?: number;
}

export function funnel(p: PostSample): Funnel {
  const m = p.metrics;
  const reach = m.reach ?? m.views ?? m.impressions;
  const f: Funnel = {};
  if (reach && p.followersAtPost && p.followersAtPost > 0) f.distribution = reach / p.followersAtPost;
  if (m.retention3s !== undefined) f.hook = m.retention3s;
  else if (m.avgWatchSec !== undefined && p.durationSec) f.hook = Math.min(1, m.avgWatchSec / p.durationSec);
  if (reach && reach > 0) {
    if (m.saves !== undefined || m.shares !== undefined) f.resonance = ((m.saves ?? 0) + (m.shares ?? 0)) / reach;
    if (m.profileVisits !== undefined || m.clicks !== undefined || m.follows !== undefined) {
      f.conversion = ((m.profileVisits ?? 0) + (m.clicks ?? 0) + (m.follows ?? 0)) / reach;
    }
  }
  return f;
}

/**
 * Reference values used when a client has no history yet: rough cross-industry medians for
 * organic content. They only anchor the first diagnosis; the client's own baseline replaces
 * them as soon as there are 8+ posts.
 */
export const BENCHMARKS: Record<Bottleneck, number> = {
  distribution: 0.35,
  hook: 0.55,
  resonance: 0.015,
  conversion: 0.012,
};

/** Which funnel stages matter most for each goal KPI. Weights multiply the shortfall. */
export const KPI_STAGE_WEIGHTS: Record<GoalKpi, Record<Bottleneck, number>> = {
  followers: { distribution: 1.2, hook: 1.0, resonance: 0.8, conversion: 1.4 },
  reach: { distribution: 1.5, hook: 1.2, resonance: 0.9, conversion: 0.4 },
  views: { distribution: 1.3, hook: 1.5, resonance: 0.8, conversion: 0.3 },
  engagement_rate: { distribution: 0.6, hook: 1.0, resonance: 1.5, conversion: 0.6 },
  profile_visits: { distribution: 1.0, hook: 0.9, resonance: 0.8, conversion: 1.5 },
  link_clicks: { distribution: 0.9, hook: 0.8, resonance: 0.7, conversion: 1.6 },
  leads: { distribution: 0.8, hook: 0.8, resonance: 0.9, conversion: 1.7 },
  saves: { distribution: 0.8, hook: 1.0, resonance: 1.6, conversion: 0.4 },
  shares: { distribution: 0.9, hook: 1.0, resonance: 1.6, conversion: 0.4 },
};

export interface Diagnosis {
  bottleneck: Bottleneck | null;
  /** Ratio of recent performance to reference, per stage (1 = on par). */
  ratios: Partial<Record<Bottleneck, number>>;
  /** Weighted shortfall per stage (higher = worse). */
  scores: Partial<Record<Bottleneck, number>>;
  reference: "own_history" | "benchmarks";
  sampleSize: number;
  evidence: string[];
}

const STAGES: Bottleneck[] = ["distribution", "hook", "resonance", "conversion"];

/**
 * Find the weakest funnel stage. Recent posts (last `recentCount`) are compared with the
 * client's older posts when there are enough, otherwise with BENCHMARKS.
 */
export function diagnose(posts: PostSample[], kpi: GoalKpi, recentCount = 6): Diagnosis {
  const sorted = [...posts].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const recent = sorted.slice(0, recentCount);
  const older = sorted.slice(recentCount);
  const useHistory = older.length >= 8;

  const stageMedian = (sample: PostSample[], stage: Bottleneck) =>
    median(sample.map((p) => funnel(p)[stage]).filter((x): x is number => x !== undefined));

  const ratios: Partial<Record<Bottleneck, number>> = {};
  const scores: Partial<Record<Bottleneck, number>> = {};
  const evidence: string[] = [];

  for (const stage of STAGES) {
    const now = stageMedian(recent, stage);
    if (now === undefined) continue;
    const ref = useHistory ? stageMedian(older, stage) : BENCHMARKS[stage];
    if (!ref || ref <= 0) continue;
    const ratio = now / ref;
    ratios[stage] = ratio;
    scores[stage] = Math.max(0, 1 - ratio) * KPI_STAGE_WEIGHTS[kpi][stage];
    evidence.push(
      `${stage}: recent median ${formatRatio(stage, now)} vs ${useHistory ? "own baseline" : "benchmark"} ${formatRatio(stage, ref)} (${Math.round(ratio * 100)}%)`,
    );
  }

  const worst = (Object.entries(scores) as Array<[Bottleneck, number]>).sort((a, b) => b[1] - a[1])[0];
  return {
    bottleneck: worst && worst[1] > 0.05 ? worst[0] : null,
    ratios,
    scores,
    reference: useHistory ? "own_history" : "benchmarks",
    sampleSize: recent.length,
    evidence,
  };
}

function formatRatio(stage: Bottleneck, v: number): string {
  if (stage === "distribution") return `${v.toFixed(2)}× followers`;
  return `${(v * 100).toFixed(stage === "hook" ? 0 : 2)}%`;
}

/** KPIs measured as a level (current value) vs as a running total since the goal started. */
export const KPI_AGGREGATION: Record<GoalKpi, "level" | "sum"> = {
  followers: "level",
  engagement_rate: "level",
  reach: "sum",
  views: "sum",
  profile_visits: "sum",
  link_clicks: "sum",
  leads: "sum",
  saves: "sum",
  shares: "sum",
};

export interface GoalInput {
  kpi: GoalKpi;
  target: number;
  baseline: number | null;
  startDate: Date;
  deadline: Date;
}

export interface PaceResult {
  status: PaceStatus;
  actual: number | null;
  expected: number | null;
  progress: number | null;
  projected: number | null;
  daysElapsed: number;
  daysLeft: number;
  requiredPerDay: number | null;
}

/** Linear-path pacing with a least-squares projection to the deadline. */
export function goalPace(goal: GoalInput, series: Array<{ date: Date; value: number }>, now: Date): PaceResult {
  const total = Math.max(1, daysBetween(goal.startDate, goal.deadline));
  const elapsed = Math.min(total, Math.max(0, daysBetween(goal.startDate, now)));
  const daysLeft = Math.max(0, daysBetween(now, goal.deadline));
  const points = series.filter((s) => s.date >= goal.startDate && s.date <= now).sort((a, b) => a.date.getTime() - b.date.getTime());
  const agg = KPI_AGGREGATION[goal.kpi];

  if (!points.length) {
    return { status: "unknown", actual: null, expected: null, progress: null, projected: null, daysElapsed: elapsed, daysLeft, requiredPerDay: null };
  }

  const baseline = goal.baseline ?? (agg === "level" ? points[0].value : 0);
  const actual = agg === "level" ? points[points.length - 1].value : points.reduce((a, p) => a + p.value, 0);
  const expected = baseline + (goal.target - baseline) * (elapsed / total);
  const span = goal.target - baseline;
  const progress = span === 0 ? 1 : (actual - baseline) / span;

  // Projection: level KPIs extrapolate the trend line; sum KPIs extrapolate the daily mean.
  let projected: number;
  if (agg === "level") {
    const xs = points.map((p) => daysBetween(goal.startDate, p.date));
    const ys = points.map((p) => p.value);
    const { slope, intercept } = linearFit(xs, ys);
    projected = intercept + slope * total;
  } else {
    const perDay = actual / Math.max(1, elapsed);
    projected = actual + perDay * daysLeft;
  }

  const remaining = goal.target - actual;
  const requiredPerDay = daysLeft > 0 ? remaining / daysLeft : null;

  let status: PaceStatus;
  if (points.length < 3 || elapsed < 2) status = "unknown";
  else {
    const expectedGain = expected - baseline;
    const actualGain = actual - baseline;
    const ratio = expectedGain === 0 ? 1 : actualGain / expectedGain;
    status = ratio >= 1.05 ? "ahead" : ratio >= 0.9 ? "on_track" : ratio >= 0.7 ? "behind" : "off_track";
  }

  return { status, actual, expected, progress, projected, daysElapsed: elapsed, daysLeft, requiredPerDay };
}

export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

export interface Anomaly {
  code: "followers_drop" | "reach_drop";
  message: string;
  value: number;
}

/** Sudden drops worth an alert: followers −2% day-on-day, reach −40% week-on-week. */
export function detectAnomalies(series: Array<{ date: Date; followers?: number; reach?: number }>): Anomaly[] {
  const s = [...series].sort((a, b) => a.date.getTime() - b.date.getTime());
  const out: Anomaly[] = [];
  const withFollowers = s.filter((p) => p.followers !== undefined);
  if (withFollowers.length >= 2) {
    const [prev, last] = withFollowers.slice(-2);
    if (prev.followers! > 0) {
      const change = (last.followers! - prev.followers!) / prev.followers!;
      if (change <= -0.02) {
        out.push({ code: "followers_drop", value: change, message: `Followers fell ${(change * -100).toFixed(1)}% day-on-day.` });
      }
    }
  }
  const withReach = s.filter((p) => p.reach !== undefined);
  if (withReach.length >= 14) {
    const lastWeek = withReach.slice(-7).reduce((a, p) => a + (p.reach ?? 0), 0);
    const priorWeek = withReach.slice(-14, -7).reduce((a, p) => a + (p.reach ?? 0), 0);
    if (priorWeek > 0) {
      const change = (lastWeek - priorWeek) / priorWeek;
      if (change <= -0.4) {
        out.push({ code: "reach_drop", value: change, message: `Reach fell ${(change * -100).toFixed(0)}% week-on-week.` });
      }
    }
  }
  return out;
}

/** Map normalised metrics to the KPI value contributed by one day/post. */
export function kpiValueFromAccount(kpi: GoalKpi, m: { followers?: number; reach?: number; views?: number; profileVisits?: number; linkClicks?: number; interactions?: number }): number | undefined {
  switch (kpi) {
    case "followers":
      return m.followers;
    case "reach":
      return m.reach;
    case "views":
      return m.views;
    case "profile_visits":
      return m.profileVisits;
    case "link_clicks":
      return m.linkClicks;
    default:
      return undefined;
  }
}

/** Compare one experiment's tagged posts with the baseline on the KPI's most relevant per-post metric. */
export function experimentLift(tagged: PostSample[], baseline: PostSample[], metric: (p: PostSample) => number | undefined): { lift: number | null; taggedMedian?: number; baselineMedian?: number } {
  const t = median(tagged.map(metric).filter((x): x is number => x !== undefined));
  const b = median(baseline.map(metric).filter((x): x is number => x !== undefined));
  if (t === undefined || b === undefined || b === 0) return { lift: null, taggedMedian: t, baselineMedian: b };
  return { lift: (t - b) / b, taggedMedian: t, baselineMedian: b };
}

export function perPostMetricForKpi(kpi: GoalKpi): (p: PostSample) => number | undefined {
  switch (kpi) {
    case "followers":
      return (p) => p.metrics.follows ?? p.metrics.profileVisits;
    case "reach":
      return (p) => p.metrics.reach;
    case "views":
      return (p) => p.metrics.views ?? p.metrics.reach;
    case "engagement_rate":
      return (p) => engagementRate(p.metrics);
    case "profile_visits":
      return (p) => p.metrics.profileVisits;
    case "link_clicks":
      return (p) => p.metrics.clicks;
    case "leads":
      return (p) => (p.metrics.replies ?? 0) + (p.metrics.clicks ?? 0) || undefined;
    case "saves":
      return (p) => p.metrics.saves;
    case "shares":
      return (p) => p.metrics.shares;
  }
}
