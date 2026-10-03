import { AlertTriangle, ArrowRight, BarChart3, CalendarClock, Check, Clapperboard, Eye, Lightbulb, MessageCircle, Radar, RefreshCcw, Send, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { loadDemoDataAction } from "@/app/actions";
import { Meter } from "@/components/charts";
import { ActionButton } from "@/components/forms";
import { EmptyState, FormatBadge, PacePill, PlatformGlyph, SectionCard, Stat, StatusPill, TextDir, timeAgo, usd } from "@/components/ui";
import { formatLocal, zonedParts } from "@/domain/time";
import { GOAL_KPI_LABEL, PLATFORM_LABEL } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { todayData } from "@/server/queries";

export const metadata = { title: "Today" };

const RUN_ICON: Record<string, typeof Sparkles> = {
  plan: Lightbulb,
  produce: Clapperboard,
  schedule: CalendarClock,
  publish: Send,
  measure: BarChart3,
  review: BarChart3,
  pivot: RefreshCcw,
  revise: RefreshCcw,
  community: MessageCircle,
  watch: Radar,
  decision: Check,
};

export default async function TodayPage() {
  await requireUser();
  const d = await todayData();
  const cfg = config();
  const tz = cfg.agencyTimezone;
  const hour = zonedParts(new Date(), tz).hour;
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const tzOf = new Map(d.clients.map((c) => [c.id, c.timezone]));
  const decisions = d.waiting.filter((w) => w.status !== "failed");
  const failed = d.waiting.filter((w) => w.status === "failed");
  const waitingTotal = decisions.length + d.needsYou.length + d.highAlerts.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">{formatLocal(new Date(), tz, { weekday: "long", day: "numeric", month: "long", hour: undefined, minute: undefined })}</p>
        <h1 className="h-display mt-1 text-3xl sm:text-4xl">
          {greeting}, {cfg.ownerName}.
        </h1>
        <p className="mt-1 text-sm text-muted">
          {waitingTotal ? `${waitingTotal} thing${waitingTotal === 1 ? "" : "s"} need${waitingTotal === 1 ? "s" : ""} you. Everything else is moving.` : "Nothing needs you right now. The agent is working through the plan."}
        </p>
      </div>

      {d.demo ? (
        <div className="card card-pad flex flex-wrap items-center justify-between gap-3 border-accent/40 bg-accent-soft">
          <p className="text-sm">
            <span className="font-semibold">Demo mode.</span> Accounts, metrics and media are simulated so you can try every step safely. Add your API keys to go live.
          </p>
          <Link href="/settings" className="btn btn-sm">
            Integrations <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting on you" value={decisions.length} sub={`${d.needsYou.length} message${d.needsYou.length === 1 ? "" : "s"} to answer`} href="/approvals" />
        <Stat label="Going out this week" value={d.upcoming.length} sub="Scheduled posts, reels & stories" href="/calendar" />
        <Stat label="In production" value={d.producing.length} sub={<span className="line-clamp-2">{d.producing[0] ? d.producing[0].title : "Nothing rendering"}</span>} href="/approvals" />
        <Stat label="Spend, last 7 days" value={usd(d.spendWeekUsd)} sub="Generation + AI" href="/settings" />
      </div>

      {!d.clients.length ? (
        <EmptyState
          title="Add your first client"
          body={
            d.demo
              ? "Give the agent a client, connect their accounts and set the goal it should hit — or load two sample clients with simulated accounts, a month of history and a fresh scenario to explore every screen."
              : "Give the agent a client, connect their Instagram, Facebook, LinkedIn and X, and set the goal it should hit."
          }
          action={
            <div className="flex flex-wrap gap-2">
              <Link href="/clients" className="btn btn-primary btn-sm">
                Add a client
              </Link>
              {d.demo ? (
                <ActionButton action={loadDemoDataAction} className="btn-sm">
                  Load sample data
                </ActionButton>
              ) : null}
            </div>
          }
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard
            title="Needs you"
            action={
              decisions.length ? (
                <Link href="/approvals" className="text-xs text-accent hover:underline">
                  All approvals
                </Link>
              ) : null
            }
          >
            {!waitingTotal && !failed.length ? <p className="text-sm text-faint">You&apos;re clear.</p> : null}
            <ul className="divide-y divide-border">
              {d.highAlerts.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={a.url ?? "/alerts"} className="text-sm font-medium hover:text-accent">
                      {a.title}
                    </Link>
                    <p className="line-clamp-2 text-xs text-muted">{a.action ?? a.summary}</p>
                  </div>
                </li>
              ))}
              {decisions.map((w) => (
                <li key={w.id} className="flex items-start gap-3 py-3 first:pt-0">
                  {w.status === "review" ? <Eye className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /> : <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <Link href={`/content/${w.id}`} className="block truncate text-sm font-medium hover:text-accent">
                      {w.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <FormatBadge format={w.format} />
                      <StatusPill status={w.status} />
                      <span>{w.client}</span>
                      {w.status === "concept" && w.quote ? <span>· quote {usd(w.quote.totalUsd)}</span> : null}
                    </div>
                  </div>
                </li>
              ))}
              {d.needsYou.map((m) => (
                <li key={m.id} className="flex items-start gap-3 py-3 first:pt-0">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href="/inbox" className="text-sm font-medium hover:text-accent">
                      {m.authorName ?? m.authorHandle ?? "Someone"} on {PLATFORM_LABEL[m.platform]} · {m.client}
                    </Link>
                    <p className="line-clamp-2 text-xs text-muted">
                      <TextDir text={m.text} />
                    </p>
                  </div>
                </li>
              ))}
              {failed.map((w) => (
                <li key={w.id} className="flex items-start gap-3 py-3 first:pt-0">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={`/content/${w.id}`} className="block truncate text-sm font-medium hover:text-accent">
                      {w.title}
                    </Link>
                    <p className="text-xs text-muted">Failed · {w.client} · open to retry</p>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard
            title="Going out next"
            action={
              <Link href="/calendar" className="text-xs text-accent hover:underline">
                Calendar
              </Link>
            }
          >
            {!d.upcoming.length ? <p className="text-sm text-faint">Nothing scheduled in the next 7 days.</p> : null}
            <ul className="space-y-2.5">
              {d.upcoming.map((u) => (
                <li key={u.id} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted tabular-nums">{formatLocal(u.scheduledAt, tzOf.get(u.clientId) ?? tz)}</span>
                  <PlatformGlyph platform={u.platform} className="shrink-0 text-muted" />
                  <Link href={`/content/${u.contentId}`} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                    {u.title}
                  </Link>
                  <span className="hidden sm:inline">
                    <FormatBadge format={u.format} />
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="Goals"
            action={
              <Link href="/analytics" className="text-xs text-accent hover:underline">
                Analytics
              </Link>
            }
          >
            <div className="space-y-5">
              {d.clients.map((c) => (
                <div key={c.id}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/analytics?client=${c.id}`} className="text-sm font-semibold hover:text-accent">
                      {c.name}
                    </Link>
                    {c.goal ? <PacePill pace={c.goal.pace} /> : null}
                  </div>
                  {c.goal ? (
                    <>
                      <p className="mb-2 text-xs text-muted">
                        {c.goal.statement} · {GOAL_KPI_LABEL[c.goal.kpi]}
                        {c.goal.platform ? ` on ${PLATFORM_LABEL[c.goal.platform]}` : ""} by {formatLocal(c.goal.deadline, c.timezone, { weekday: undefined, hour: undefined, minute: undefined })}
                      </p>
                      <Meter value={c.goal.current} target={c.goal.target} baseline={c.goal.baseline} pace={c.goal.pace} />
                      {c.goal.agentRead ?? c.agentRead ? <p className="mt-2 text-xs leading-relaxed text-muted">{c.goal.agentRead ?? c.agentRead}</p> : null}
                    </>
                  ) : (
                    <Link href={`/clients/${c.id}#goal`} className="text-xs text-accent hover:underline">
                      Set the goal the agent should hit →
                    </Link>
                  )}
                </div>
              ))}
              {!d.clients.length ? <p className="text-sm text-faint">No clients yet.</p> : null}
            </div>
          </SectionCard>

          <SectionCard title="What the agent did">
            {!d.activity.length ? <p className="text-sm text-faint">No activity yet.</p> : null}
            <ol className="space-y-3">
              {d.activity.map((r) => {
                const Icon = RUN_ICON[r.kind] ?? Sparkles;
                return (
                  <li key={r.id} className="flex gap-3">
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${r.ok ? "bg-surface-2 text-muted" : "bg-surface-2 text-danger"}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{r.summary}</p>
                      <p className="text-xs text-faint">
                        {r.client ? `${r.client} · ` : ""}
                        {timeAgo(r.startedAt)}
                        {r.ok ? "" : " · failed"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
