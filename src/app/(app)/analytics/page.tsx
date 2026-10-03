import clsx from "clsx";
import Link from "next/link";
import { BarList, Meter, Sparkline, type BarRow } from "@/components/charts";
import { LineChart, type LinePoint } from "@/components/line-chart";
import { compact, EmptyState, FormatBadge, PacePill, PageHeader, PlatformGlyph, SectionCard, timeAgo } from "@/components/ui";
import { diagnose, engagementRate, KPI_AGGREGATION } from "@/domain/analytics";
import { formatLocal } from "@/domain/time";
import { GOAL_KPI_LABEL, PLATFORM_LABEL, type AccountMetrics, type Bottleneck, type Platform } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { analyticsData, clientsList } from "@/server/queries";

export const metadata = { title: "Analytics" };

const BOTTLENECK_COPY: Record<Bottleneck, { title: string; body: string }> = {
  distribution: { title: "Distribution", body: "Posts aren't travelling far beyond existing followers. The agent leans on trends, collabs, trial reels and stronger shareability." },
  hook: { title: "Hook", body: "People scroll past in the first seconds. The agent tests cold opens, motion in frame one and sharper on-screen lines." },
  resonance: { title: "Resonance", body: "People watch but don't save or share. The agent shifts to more useful, specific and emotionally sharper content." },
  conversion: { title: "Conversion", body: "Engagement isn't turning into profile visits, clicks or follows. The agent tightens CTAs, bio paths and offers." },
};

const EXP_STATUS: Record<string, string> = {
  running: "text-info border-info/40",
  kept: "text-success border-success/40",
  reverted: "text-warning border-warning/40",
  inconclusive: "text-muted",
  proposed: "text-accent border-accent/40",
  rejected: "text-faint",
};

function pctRows(rec: Record<string, number> | Array<{ name: string; value: number }> | undefined, limit = 6, sort = true): BarRow[] {
  if (!rec) return [];
  const entries = Array.isArray(rec) ? rec.map((r) => [r.name, r.value] as const) : Object.entries(rec);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const rows = entries.map(([label, value]) => ({ label, value: value / total, display: `${Math.round((value / total) * 100)}%` }));
  return (sort ? rows.sort((a, b) => b.value - a.value) : rows).slice(0, limit);
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ client?: string; days?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const clients = await clientsList();
  if (!clients.length) {
    return (
      <div>
        <PageHeader title="Analytics" />
        <EmptyState title="No clients yet" body="Analytics appear once a client's accounts are connected and the first posts go out." />
      </div>
    );
  }
  const clientId = clients.some((c) => c.id === sp.client) ? sp.client! : clients[0].id;
  const days = sp.days === "90" ? 90 : sp.days === "7" ? 7 : 30;
  const d = (await analyticsData(clientId, days))!;
  const tz = d.client.timezone;
  const href = (o: { client?: string; days?: number }) => `/analytics?client=${o.client ?? clientId}&days=${o.days ?? days}`;

  // Goal chart: level KPIs plot the reading, flow KPIs plot the running total inside the goal window.
  let goalPoints: LinePoint[] = [];
  let pathPoints: LinePoint[] | undefined;
  if (d.goal) {
    const agg = KPI_AGGREGATION[d.goal.kpi];
    const windowed = d.series.filter((s) => agg === "level" || s.date >= d.goal!.startDate);
    let run = 0;
    goalPoints = windowed.map((s) => ({ date: s.date.toISOString(), value: agg === "level" ? s.value : (run += s.value) }));
    const base = d.goal.baseline ?? (agg === "level" ? (goalPoints[0]?.value ?? 0) : 0);
    pathPoints = [
      { date: d.goal.startDate.toISOString(), value: base },
      { date: d.goal.deadline.toISOString(), value: d.goal.target },
    ];
  }

  // Account KPIs per platform over the range.
  const platforms = [...new Set(d.kpis.map((k) => k.platform))] as Platform[];
  const perPlatform = platforms.map((p) => {
    const rows = d.kpis.filter((k) => k.platform === p).map((k) => k.metrics as AccountMetrics);
    const followers = rows.map((r) => r.followers).filter((v): v is number => v !== undefined);
    const sum = (k: keyof AccountMetrics) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
    return {
      platform: p,
      followers,
      followersNow: followers.at(-1),
      followersDelta: followers.length > 1 ? followers.at(-1)! - followers[0] : undefined,
      reach: sum("reach"),
      views: sum("views"),
      profileVisits: sum("profileVisits"),
      linkClicks: sum("linkClicks"),
    };
  });

  const diagnosis = d.samples.length ? diagnose(d.samples, d.goal?.kpi ?? "reach") : null;
  const ratioRows: BarRow[] = diagnosis
    ? (Object.entries(diagnosis.ratios) as Array<[Bottleneck, number]>).map(([stage, r]) => ({ label: BOTTLENECK_COPY[stage].title, value: r, display: `${Math.round(r * 100)}%` }))
    : [];
  const top = [...d.samples].sort((a, b) => (b.metrics.reach ?? b.metrics.views ?? 0) - (a.metrics.reach ?? a.metrics.views ?? 0)).slice(0, 12);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Engagement, reach, audience and clicks — and how the agent reads them against the goal." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1.5" aria-label="Client">
          {clients.map((c) => (
            <Link key={c.id} href={href({ client: c.id })} className={clsx("badge px-3 py-1.5 text-xs", c.id === clientId && "border-accent bg-accent-soft text-fg")}>
              {c.name}
            </Link>
          ))}
        </nav>
        <nav className="flex gap-1" aria-label="Range">
          {[7, 30, 90].map((n) => (
            <Link key={n} href={href({ days: n })} className={clsx("btn btn-sm", n === days && "border-accent text-fg")}>
              {n} days
            </Link>
          ))}
        </nav>
      </div>

      <SectionCard
        title="Goal"
        action={
          <Link href={`/clients/${clientId}#goal`} className="text-xs text-accent hover:underline">
            {d.goal ? "Change goal" : "Set a goal"}
          </Link>
        }
      >
        {d.goal ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <PacePill pace={d.pace?.status ?? d.goal.pace} />
              </div>
              <p className="text-sm font-medium">{d.goal.statement}</p>
              <Meter value={d.pace?.actual ?? d.goal.current} target={d.goal.target} baseline={d.goal.baseline} pace={d.pace?.status ?? d.goal.pace} />
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted">Deadline</dt>
                  <dd>{formatLocal(d.goal.deadline, tz, { weekday: undefined, hour: undefined, minute: undefined })}</dd>
                </div>
                <div>
                  <dt className="text-muted">Days left</dt>
                  <dd className="tabular-nums">{d.pace ? Math.ceil(d.pace.daysLeft) : "–"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Projected</dt>
                  <dd className="tabular-nums">{compact(d.pace?.projected)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Needed per day</dt>
                  <dd className="tabular-nums">{compact(d.pace?.requiredPerDay)}</dd>
                </div>
              </dl>
              {d.goal.agentRead ? <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">{d.goal.agentRead}</p> : null}
            </div>
            <LineChart points={goalPoints} path={pathPoints} label={`${GOAL_KPI_LABEL[d.goal.kpi]} toward the goal`} valueLabel={GOAL_KPI_LABEL[d.goal.kpi]} pathLabel="On-pace path" />
          </div>
        ) : (
          <p className="text-sm text-muted">No goal set. The agent still measures everything, but it can only pivot toward a target you give it.</p>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title={`Accounts · last ${days} days`}>
          {!perPlatform.length ? <p className="text-sm text-faint">No account readings yet — they arrive with the daily KPI check.</p> : null}
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-1 pb-2 font-medium">Platform</th>
                  <th className="px-1 pb-2 font-medium">Followers</th>
                  <th className="px-1 pb-2 text-right font-medium">Reach</th>
                  <th className="px-1 pb-2 text-right font-medium">Views</th>
                  <th className="px-1 pb-2 text-right font-medium">Profile</th>
                  <th className="px-1 pb-2 text-right font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {perPlatform.map((r) => (
                  <tr key={r.platform}>
                    <td className="px-1 py-2">
                      <span className="flex items-center gap-1.5">
                        <PlatformGlyph platform={r.platform} /> {PLATFORM_LABEL[r.platform]}
                      </span>
                    </td>
                    <td className="px-1 py-2">
                      <span className="flex items-center gap-2">
                        <Sparkline values={r.followers} width={64} height={22} label={`${PLATFORM_LABEL[r.platform]} followers trend`} />
                        <span className="tabular-nums">
                          {compact(r.followersNow)}
                          {r.followersDelta !== undefined ? (
                            <span className={clsx("ml-1 text-xs", r.followersDelta >= 0 ? "text-success" : "text-danger")}>
                              {r.followersDelta >= 0 ? "+" : ""}
                              {compact(r.followersDelta)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums">{compact(r.reach)}</td>
                    <td className="px-1 py-2 text-right tabular-nums">{compact(r.views)}</td>
                    <td className="px-1 py-2 text-right tabular-nums">{compact(r.profileVisits)}</td>
                    <td className="px-1 py-2 text-right tabular-nums">{compact(r.linkClicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Where the funnel leaks">
          {diagnosis ? (
            <>
              {diagnosis.bottleneck ? (
                <div className="mb-4 rounded-xl border border-warning/40 p-3">
                  <p className="text-sm font-semibold text-warning">Bottleneck: {BOTTLENECK_COPY[diagnosis.bottleneck].title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{BOTTLENECK_COPY[diagnosis.bottleneck].body}</p>
                </div>
              ) : (
                <p className="mb-4 text-sm text-success">No clear bottleneck — every stage is near its reference.</p>
              )}
              <BarList rows={ratioRows} max={Math.max(1.2, ...ratioRows.map((r) => r.value))} title="Funnel stage vs reference" />
              <p className="mt-3 text-xs text-faint">
                Last {diagnosis.sampleSize} posts vs {diagnosis.reference === "own_history" ? "this client's earlier posts" : "industry benchmarks"} · 100% = on par.
              </p>
            </>
          ) : (
            <p className="text-sm text-faint">Needs a few published posts with metrics.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard title={`Top posts · last ${days} days`}>
        {!top.length ? <p className="text-sm text-faint">No published posts with metrics in this range.</p> : null}
        {top.length ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-1 pb-2 font-medium">Post</th>
                  <th className="px-1 pb-2 font-medium">Format</th>
                  <th className="px-1 pb-2 text-right font-medium">Reach</th>
                  <th className="px-1 pb-2 text-right font-medium">Eng. rate</th>
                  <th className="px-1 pb-2 text-right font-medium">Saves</th>
                  <th className="px-1 pb-2 text-right font-medium">Shares</th>
                  <th className="px-1 pb-2 text-right font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {top.map((p) => {
                  const er = engagementRate(p.metrics);
                  return (
                    <tr key={p.id}>
                      <td className="max-w-64 px-1 py-2">
                        <Link href={`/content/${p.contentId}`} className="flex items-center gap-1.5 hover:text-accent">
                          <PlatformGlyph platform={p.platform} className="shrink-0 text-muted" />
                          <span className="truncate">{p.title}</span>
                        </Link>
                        <span className="text-[11px] text-faint">
                          {PLATFORM_LABEL[p.platform]} · {formatLocal(p.publishedAt, tz, { hour: undefined, minute: undefined })}
                        </span>
                      </td>
                      <td className="px-1 py-2">
                        <FormatBadge format={p.format} />
                      </td>
                      <td className="px-1 py-2 text-right tabular-nums">{compact(p.metrics.reach ?? p.metrics.views)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{er !== undefined ? `${er.toFixed(1)}%` : "–"}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{compact(p.metrics.saves)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{compact(p.metrics.shares)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{compact(p.metrics.clicks)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>

      <section>
        <h2 className="section-title">Audience</h2>
        {!d.audience.length ? <p className="text-sm text-faint">Audience breakdowns arrive with the daily KPI check (platforms need ~100 followers to report them).</p> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {d.audience.map((a) => {
            const blocks: Array<[string, BarRow[]]> = [
              ["Age", pctRows(a.data.age, 8, false).sort((x, y) => parseInt(x.label, 10) - parseInt(y.label, 10))],
              ["Gender", pctRows(a.data.gender, 3)],
              ["Cities", pctRows(a.data.cities)],
              ["Countries", pctRows(a.data.countries)],
              ["Seniority", pctRows(a.data.seniorities)],
              ["Industries", pctRows(a.data.industries)],
              ["Job functions", pctRows(a.data.functions)],
            ];
            return (
              <div key={a.id} className="card card-pad">
                <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                  <PlatformGlyph platform={a.platform} /> {PLATFORM_LABEL[a.platform]}
                  <span className="ml-auto text-xs font-normal text-faint">{timeAgo(a.capturedAt)}</span>
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {blocks
                    .filter(([, rows]) => rows.length)
                    .map(([title, rows]) => (
                      <div key={title}>
                        <p className="label">{title}</p>
                        <BarList rows={rows} title={`${PLATFORM_LABEL[a.platform]} audience by ${title.toLowerCase()}`} max={Math.max(...rows.map((r) => r.value))} />
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Experiments & pivots">
          {!d.experiments.length ? <p className="text-sm text-faint">No experiments yet. The weekly review starts one when the goal needs a push.</p> : null}
          <ul className="space-y-3">
            {d.experiments.map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={clsx("badge", EXP_STATUS[e.status])}>{e.status}</span>
                  <span className="badge">{e.kind === "micro" ? "Micro-pivot" : "Pivot"}</span>
                  <span className="text-xs text-muted">{e.lever}</span>
                  <span className="ml-auto text-xs text-faint">{timeAgo(e.startedAt)}</span>
                </div>
                <p className="mt-2">{e.change}</p>
                <p className="mt-1 text-xs text-muted">
                  Because {e.finding.charAt(0).toLowerCase() + e.finding.slice(1)} Expecting: {e.expected}
                </p>
                {e.result ? <p className="mt-1 text-xs text-fg">Result: {e.result}</p> : null}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="What the agent has learned">
          {!d.insights.length ? <p className="text-sm text-faint">Learnings accumulate from experiments and weekly reviews.</p> : null}
          <ul className="space-y-2.5">
            {d.insights.map((i) => (
              <li key={i.id} className="text-sm">
                <span className={clsx("badge mr-1.5", i.confidence === "high" ? "text-success border-success/40" : i.confidence === "medium" ? "text-accent border-accent/40" : "")}>{i.confidence}</span>
                {i.text}
                {i.evidence ? <span className="block text-xs text-faint">{i.evidence}</span> : null}
              </li>
            ))}
          </ul>
          {d.lastReview ? (
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
              Last review {timeAgo(d.lastReview.startedAt)}: {d.lastReview.summary}
            </p>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}
