import type { Diagnosis, PaceResult } from "@/domain/analytics";
import { isoWithOffset } from "@/domain/time";
import type { AudienceBreakdown, ClientAutonomy, ClientBrief, GoalKpi, PaceStatus, Platform } from "@/domain/types";
import { GOAL_KPI_LABEL } from "@/domain/types";

/** Everything the agent knows about one client, assembled by the server before each call. */
export interface ClientContext {
  client: {
    id: string;
    name: string;
    timezone: string;
    languages: string[];
    website?: string | null;
    industry?: string | null;
    brief: ClientBrief;
    autonomy: ClientAutonomy;
  };
  goal: {
    id: string;
    statement: string;
    kpi: GoalKpi;
    platform: Platform | null;
    target: number;
    baseline: number | null;
    current: number | null;
    startDate: Date;
    deadline: Date;
    pace: PaceStatus;
    agentRead: string | null;
  } | null;
  pace?: PaceResult | null;
  diagnosis?: Diagnosis | null;
  insights: Array<{ text: string; confidence: string; evidence?: string | null }>;
  experiments: Array<{ id: string; lever: string; change: string; expected: string; metric: string; reviewOn: Date; status: string; bottleneck?: string | null }>;
  recent: Array<{
    title: string;
    angle?: string | null;
    format: string;
    platforms: string[];
    status: string;
    publishedAt?: Date | null;
    engagementRate?: number;
    reach?: number;
    views?: number;
    saves?: number;
    shares?: number;
    follows?: number;
    profileVisits?: number;
  }>;
  audience?: { platform: Platform; data: AudienceBreakdown } | null;
  connected: Platform[];
  now: Date;
}

function list(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none yet)";
}

function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function topEntries(rec: Record<string, number> | undefined, n = 4): string {
  if (!rec) return "n/a";
  const total = Object.values(rec).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`)
    .join(", ");
}

/** Stable client brief: changes rarely, so it is cached as its own system block. */
export function renderClientBrief(ctx: ClientContext): string {
  const { client } = ctx;
  const b = client.brief;
  return `<client id="${client.id}">
Name: ${client.name}
Industry: ${client.industry ?? "n/a"} · Website: ${client.website ?? "n/a"}
Time zone: ${client.timezone} · Languages: ${client.languages.join(", ")}
Connected platforms: ${ctx.connected.length ? ctx.connected.join(", ") : "none yet (plan and produce anyway; publishing waits)"}

Positioning: ${b.positioning || "n/a"}
Services: ${b.services || "n/a"}
Voice: ${b.voice || "n/a"}
Audience: ${b.audience || "n/a"}
Content pillars:
${list(b.pillars)}
Visual grammar: ${b.visualGrammar || "house look (photoreal cinema)"}
Guardrails (these win over everything):
${list(b.guardrails)}
Calls to action we use:
${list(b.ctas)}
Brand hashtags: ${b.hashtags.join(" ") || "n/a"}
Competitors / references: ${b.competitors.join(", ") || "n/a"}
Notes: ${b.notes || "n/a"}
Cadence target per week: ${client.autonomy.cadence.reelsPerWeek} reels, ${client.autonomy.cadence.feedPostsPerWeek} feed posts, ${client.autonomy.cadence.storiesPerWeek} stories, ${client.autonomy.cadence.linkedinPerWeek} LinkedIn, ${client.autonomy.cadence.xPerWeek} X
Weekly production budget: $${client.autonomy.weeklyBudgetUsd}
</client>`;
}

/** Volatile state: goal, pace, diagnosis, experiments, recent results. Goes in the user turn. */
export function renderClientState(ctx: ClientContext): string {
  const parts: string[] = [];
  parts.push(`Now: ${isoWithOffset(ctx.now, ctx.client.timezone)} (${ctx.client.timezone})`);

  if (ctx.goal) {
    const g = ctx.goal;
    parts.push(`<goal>
Statement: ${g.statement}
KPI: ${GOAL_KPI_LABEL[g.kpi]}${g.platform ? ` on ${g.platform}` : " (all platforms)"} · target ${num(g.target, 2)} · baseline ${num(g.baseline, 2)} · current ${num(g.current, 2)}
Window: ${g.startDate.toISOString().slice(0, 10)} → ${g.deadline.toISOString().slice(0, 10)}
Pace: ${g.pace}${ctx.pace ? ` (expected now ${num(ctx.pace.expected, 1)}, projected at deadline ${num(ctx.pace.projected, 1)}, needed per day ${num(ctx.pace.requiredPerDay, 1)}, ${Math.round(ctx.pace.daysLeft)} days left)` : ""}
Last read: ${g.agentRead ?? "none"}
</goal>`);
  } else {
    parts.push("<goal>No goal set yet. Optimise for reach among the target audience and flag that a goal is needed.</goal>");
  }

  if (ctx.diagnosis) {
    const d = ctx.diagnosis;
    parts.push(`<diagnosis reference="${d.reference}" sample="${d.sampleSize}">
Weakest link: ${d.bottleneck ?? "none clear"}
${d.evidence.map((e) => `- ${e}`).join("\n") || "- not enough data"}
</diagnosis>`);
  }

  parts.push(`<running_experiments>
${ctx.experiments.length ? ctx.experiments.map((e) => `- [${e.id}] ${e.lever}: ${e.change} → expect ${e.expected} (metric ${e.metric}, review ${e.reviewOn.toISOString().slice(0, 10)}, ${e.status})`).join("\n") : "- none"}
</running_experiments>`);

  parts.push(`<learnings>
${ctx.insights.length ? ctx.insights.map((i) => `- (${i.confidence}) ${i.text}${i.evidence ? ` — ${i.evidence}` : ""}`).join("\n") : "- none yet"}
</learnings>`);

  parts.push(`<recent_content newest_first="true">
${
  ctx.recent.length
    ? ctx.recent
        .map(
          (r) =>
            `- "${r.title}" · ${r.format} · ${r.angle ?? "?"} · ${r.platforms.join("/")} · ${r.status}${r.publishedAt ? ` · ${r.publishedAt.toISOString().slice(0, 10)}` : ""}${
              r.reach !== undefined || r.views !== undefined
                ? ` · reach ${num(r.reach)} · views ${num(r.views)} · ER ${num(r.engagementRate, 1)}% · saves ${num(r.saves)} · shares ${num(r.shares)} · follows ${num(r.follows)}`
                : ""
            }`,
        )
        .join("\n")
    : "- nothing published yet"
}
</recent_content>`);

  if (ctx.audience) {
    const a = ctx.audience.data;
    parts.push(`<audience platform="${ctx.audience.platform}">
Age: ${topEntries(a.age)} · Gender: ${topEntries(a.gender, 3)}
Top cities: ${(a.cities ?? []).slice(0, 5).map((c) => c.name).join(", ") || "n/a"}
Top countries: ${(a.countries ?? []).slice(0, 5).map((c) => c.name).join(", ") || "n/a"}
${a.industries?.length ? `Industries: ${a.industries.slice(0, 5).map((c) => c.name).join(", ")}` : ""}
${a.seniorities?.length ? `Seniority: ${a.seniorities.slice(0, 4).map((c) => c.name).join(", ")}` : ""}
</audience>`);
  }

  return parts.join("\n\n");
}
