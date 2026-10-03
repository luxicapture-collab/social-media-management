import clsx from "clsx";
import { BarChart3, Link2, Pause, Play, Sparkles, Unplug, Wand2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDemoAction, disconnectAction, draftBriefAction, saveMetricoolAction, setClientStatusAction, setGoalAction, setRouteAction, updateClientAction } from "@/app/actions";
import { Field, TimezoneInput } from "@/components/fields";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { compact, PacePill, PlatformGlyph, SectionCard, StatusPill, timeAgo } from "@/components/ui";
import { formatLocal } from "@/domain/time";
import { CONTENT_STATUSES, GOAL_KPI_LABEL, GOAL_KPIS, PLATFORM_LABEL, PLATFORMS, type Platform } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { isConfigured } from "@/server/platforms/oauth";
import { clientDetail } from "@/server/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await clientDetail(id);
  return { title: d?.client.name ?? "Client" };
}

const OAUTH: Array<{ key: "meta" | "linkedin" | "x"; label: string; covers: Platform[]; env: string }> = [
  { key: "meta", label: "Connect Instagram + Facebook", covers: ["instagram", "facebook"], env: "META_APP_ID / META_APP_SECRET" },
  { key: "linkedin", label: "Connect LinkedIn page", covers: ["linkedin"], env: "LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET" },
  { key: "x", label: "Connect X", covers: ["x"], env: "X_CLIENT_ID" },
];

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const d = await clientDetail(id);
  if (!d) notFound();
  const { client, connections, goals, counts } = d;
  const cfg = config();
  const b = client.brief;
  const a = client.autonomy;
  const goal = goals.find((g) => g.status === "active");
  const metricool = connections.find((c) => c.platform === "metricool");
  const hasLive = connections.some((c) => c.mode === "live");
  const defaultDeadline = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/clients" className="text-xs text-muted hover:text-fg">
            ← Clients
          </Link>
          <h1 className="h-display mt-1 text-2xl sm:text-3xl">{client.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {client.industry ? `${client.industry} · ` : ""}
            {client.timezone} · {client.languages.join(", ")}
            {client.website ? (
              <>
                {" · "}
                <a href={client.website} target="_blank" rel="noreferrer" className="hover:text-fg">
                  {client.website.replace(/^https?:\/\//, "")}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/studio?client=${client.id}`} className="btn btn-primary btn-sm">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> New scenario
          </Link>
          <Link href={`/analytics?client=${client.id}`} className="btn btn-sm">
            <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Analytics
          </Link>
          {client.status === "paused" ? (
            <ActionButton action={setClientStatusAction.bind(null, client.id, "active")} className="btn-sm">
              <Play className="h-3.5 w-3.5" aria-hidden /> Resume agent
            </ActionButton>
          ) : (
            <ActionButton action={setClientStatusAction.bind(null, client.id, "paused")} className="btn-sm" confirm="Pause all agent activity (planning, publishing, replies) for this client?">
              <Pause className="h-3.5 w-3.5" aria-hidden /> Pause agent
            </ActionButton>
          )}
        </div>
      </div>

      {sp.connected ? <p className="card card-pad border-success/40 text-sm text-success">Account connected. The agent picks it up on the next run.</p> : null}
      {sp.error ? <p className="card card-pad border-danger/40 text-sm text-danger">Couldn&apos;t connect: {sp.error}</p> : null}
      {client.status === "paused" ? <p className="card card-pad border-warning/40 text-sm text-warning">The agent is paused for this client — nothing is planned, published or replied to.</p> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Accounts">
          <ul className="divide-y divide-border">
            {PLATFORMS.map((p) => {
              const c = connections.find((x) => x.platform === p);
              return (
                <li key={p} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformGlyph platform={p} className="h-4 w-4" />
                    <span className="text-sm font-medium">{PLATFORM_LABEL[p]}</span>
                    {c ? (
                      <>
                        <span className="truncate text-xs text-muted">{c.accountName ?? c.handle ?? c.accountId}</span>
                        <span className={clsx("badge", c.status === "connected" ? "text-success border-success/40" : "text-danger border-danger/40")}>{c.status}</span>
                        {c.mode === "demo" ? <span className="badge">Demo</span> : null}
                        <span className="ml-auto flex gap-1">
                          {metricool ? (
                            <ActionButton action={setRouteAction.bind(null, client.id, p, c.route === "direct" ? "metricool" : "direct")} className="btn-ghost btn-sm text-muted">
                              {c.route === "direct" ? "Direct API" : "Via Metricool"} ⇄
                            </ActionButton>
                          ) : null}
                          <ActionButton action={disconnectAction.bind(null, client.id, p)} className="btn-ghost btn-sm text-muted" confirm={`Disconnect ${PLATFORM_LABEL[p]}?`}>
                            <Unplug className="h-3.5 w-3.5" aria-hidden />
                            <span className="sr-only">Disconnect</span>
                          </ActionButton>
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-faint">Not connected</span>
                    )}
                  </div>
                  {c?.lastError ? <p className="mt-1 text-xs text-danger">{c.lastError}</p> : null}
                  {c?.tokenExpiresAt ? <p className="mt-1 text-xs text-faint">Token renews before {formatLocal(c.tokenExpiresAt, client.timezone, { hour: undefined, minute: undefined })}</p> : null}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {OAUTH.map((o) =>
              isConfigured(o.key) ? (
                <a key={o.key} href={`/api/connect/${o.key}/start?clientId=${client.id}`} className="btn btn-sm">
                  <Link2 className="h-3.5 w-3.5" aria-hidden /> {o.label}
                </a>
              ) : (
                <span key={o.key} className="btn btn-sm cursor-not-allowed opacity-50" title={`Set ${o.env} on the server to enable`}>
                  <Link2 className="h-3.5 w-3.5" aria-hidden /> {o.label}
                </span>
              ),
            )}
            {cfg.demo || !hasLive ? (
              <ActionButton action={connectDemoAction.bind(null, client.id)} className="btn-ghost btn-sm text-muted">
                Use simulated demo accounts
              </ActionButton>
            ) : null}
          </div>
          <details className="mt-4 rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Metricool (optional publishing route){metricool ? " · connected" : ""}</summary>
            <p className="mt-2 text-xs text-muted">Route any platform through Metricool instead of the direct API — useful while Meta or LinkedIn app review is pending. Find the brand id (blogId) in Metricool → Settings → API.</p>
            <ActionForm action={saveMetricoolAction.bind(null, client.id)} className="mt-3 grid gap-3 sm:grid-cols-3">
              <input name="blogId" className="input" placeholder="Brand id (blogId)" defaultValue={metricool?.accountId ?? ""} aria-label="Metricool brand id" />
              <input name="userId" className="input" placeholder={cfg.metricool.userId ? "User id (from env)" : "User id"} aria-label="Metricool user id" />
              <input name="token" type="password" className="input" placeholder={cfg.metricool.userToken ? "API token (from env)" : "API token"} aria-label="Metricool API token" autoComplete="off" />
              <SubmitButton className="btn-sm sm:col-span-3 sm:justify-self-start">Save Metricool brand</SubmitButton>
            </ActionForm>
            {metricool ? (
              <ActionButton action={disconnectAction.bind(null, client.id, "metricool")} className="btn-ghost btn-sm mt-2 text-muted" confirm="Remove the Metricool brand? Platforms routed through it go back to direct.">
                Remove Metricool
              </ActionButton>
            ) : null}
          </details>
        </SectionCard>

        <SectionCard title="Goal">
          <div id="goal" className="scroll-mt-24" />
          {goal ? (
            <div className="mb-4 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{goal.statement}</p>
                <PacePill pace={goal.pace} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {GOAL_KPI_LABEL[goal.kpi]}
                {goal.platform ? ` on ${PLATFORM_LABEL[goal.platform]}` : " across platforms"}: {compact(goal.current)} now → {compact(goal.target)} by {formatLocal(goal.deadline, client.timezone, { hour: undefined, minute: undefined })}
              </p>
              {goal.agentRead ? <p className="mt-2 text-xs leading-relaxed text-muted">{goal.agentRead}</p> : null}
            </div>
          ) : (
            <p className="mb-4 text-sm text-muted">Give the agent one measurable goal. It paces against it daily and pivots the content when it falls behind.</p>
          )}
          <ActionForm action={setGoalAction.bind(null, client.id)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={goal ? "New goal (replaces the current one)" : "Goal"} htmlFor="statement" className="sm:col-span-2">
              <input id="statement" name="statement" className="input" required placeholder="e.g. Grow Instagram to 10K followers by year end" />
            </Field>
            <Field label="KPI" htmlFor="kpi">
              <select id="kpi" name="kpi" className="input" defaultValue="followers">
                {GOAL_KPIS.map((k) => (
                  <option key={k} value={k}>
                    {GOAL_KPI_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Platform" htmlFor="platform">
              <select id="platform" name="platform" className="input" defaultValue="">
                <option value="">All platforms</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Target" htmlFor="target" hint="Followers: the level to reach. Reach, clicks, leads…: total over the goal window.">
              <input id="target" name="target" type="number" step="any" min={0} required className="input" />
            </Field>
            <Field label="Baseline (optional)" htmlFor="baseline" hint="Blank = today's reading.">
              <input id="baseline" name="baseline" type="number" step="any" className="input" />
            </Field>
            <Field label="Deadline" htmlFor="deadline">
              <input id="deadline" name="deadline" type="date" required className="input" defaultValue={defaultDeadline} />
            </Field>
            <div className="flex items-end">
              <SubmitButton className="btn-primary w-full">Set goal</SubmitButton>
            </div>
          </ActionForm>
          {goals.length > 1 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted">Previous goals</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {goals
                  .filter((g) => g.id !== goal?.id)
                  .map((g) => (
                    <li key={g.id}>
                      {g.statement} · {g.status} · {timeAgo(g.createdAt)}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard
        title="Brief, voice & autonomy"
        action={
          <ActionButton action={draftBriefAction.bind(null, client.id)} className="btn-sm">
            <Wand2 className="h-3.5 w-3.5" aria-hidden /> Draft empty fields{client.website ? " from website" : ""}
          </ActionButton>
        }
      >
        <ActionForm action={updateClientAction.bind(null, client.id)}>
          <div key={client.updatedAt.getTime()} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name" htmlFor="b-name">
              <input id="b-name" name="name" className="input" defaultValue={client.name} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" htmlFor="b-status">
                <select id="b-status" name="status" className="input" defaultValue={client.status}>
                  <option value="onboarding">Onboarding</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </Field>
              <Field label="Languages" htmlFor="b-languages">
                <input id="b-languages" name="languages" className="input" defaultValue={client.languages.join(", ")} />
              </Field>
            </div>
            <Field label="Time zone" htmlFor="b-tz">
              <TimezoneInput id="b-tz" defaultValue={client.timezone} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Website" htmlFor="b-website">
                <input id="b-website" name="website" className="input" defaultValue={client.website ?? ""} />
              </Field>
              <Field label="Industry" htmlFor="b-industry">
                <input id="b-industry" name="industry" className="input" defaultValue={client.industry ?? ""} />
              </Field>
            </div>
            <Field label="Positioning" htmlFor="positioning" hint="What they are, for whom, and why them — one or two sentences.">
              <textarea id="positioning" name="positioning" rows={3} className="input" defaultValue={b.positioning} dir="auto" />
            </Field>
            <Field label="Services / offers" htmlFor="services">
              <textarea id="services" name="services" rows={3} className="input" defaultValue={b.services} dir="auto" />
            </Field>
            <Field label="Voice" htmlFor="voice" hint="How they sound. Words they use and never use.">
              <textarea id="voice" name="voice" rows={3} className="input" defaultValue={b.voice} dir="auto" />
            </Field>
            <Field label="Audience" htmlFor="audience">
              <textarea id="audience" name="audience" rows={3} className="input" defaultValue={b.audience} dir="auto" />
            </Field>
            <Field label="Content pillars" htmlFor="pillars" hint="One per line.">
              <textarea id="pillars" name="pillars" rows={4} className="input" defaultValue={b.pillars.join("\n")} dir="auto" />
            </Field>
            <Field label="Visual grammar" htmlFor="visualGrammar" hint="Look, palette, lenses, light, what to avoid.">
              <textarea id="visualGrammar" name="visualGrammar" rows={4} className="input" defaultValue={b.visualGrammar} dir="auto" />
            </Field>
            <Field label="Guardrails" htmlFor="guardrails" hint="Hard rules, one per line (claims, topics, competitors…).">
              <textarea id="guardrails" name="guardrails" rows={4} className="input" defaultValue={b.guardrails.join("\n")} dir="auto" />
            </Field>
            <Field label="Calls to action" htmlFor="ctas" hint="One per line.">
              <textarea id="ctas" name="ctas" rows={4} className="input" defaultValue={b.ctas.join("\n")} dir="auto" />
            </Field>
            <Field label="Hashtags" htmlFor="hashtags" hint="Space separated; the agent picks a few per post.">
              <textarea id="hashtags" name="hashtags" rows={2} className="input" defaultValue={b.hashtags.join(" ")} />
            </Field>
            <Field label="Competitors / references" htmlFor="competitors" hint="One per line.">
              <textarea id="competitors" name="competitors" rows={2} className="input" defaultValue={b.competitors.join("\n")} dir="auto" />
            </Field>
            <Field label="Notes" htmlFor="notes" className="md:col-span-2">
              <textarea id="notes" name="notes" rows={3} className="input" defaultValue={b.notes} dir="auto" />
            </Field>

            <div className="border-t border-border pt-4 md:col-span-2">
              <p className="section-title">Autonomy</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Comment & DM replies" htmlFor="replies" hint="Auto: routine replies go out; leads, complaints and sensitive ones come to you.">
                  <select id="replies" name="replies" className="input" defaultValue={a.replies}>
                    <option value="auto">Auto-reply routine messages</option>
                    <option value="draft">Draft everything for me</option>
                    <option value="off">Off</option>
                  </select>
                </Field>
                <Field label="Weekly budget (USD)" htmlFor="weeklyBudgetUsd" hint="Generation spend cap the planner respects.">
                  <input id="weeklyBudgetUsd" name="weeklyBudgetUsd" type="number" min={0} className="input" defaultValue={a.weeklyBudgetUsd} />
                </Field>
                <Field label="AI disclosure line" htmlFor="aiDisclosureText" hint="Added to captions of AI-generated media on direct-API posts. Empty = off.">
                  <input id="aiDisclosureText" name="aiDisclosureText" className="input" defaultValue={a.aiDisclosureText} />
                </Field>
                <label className="flex items-start gap-2 pt-6 text-sm">
                  <input type="checkbox" name="autoApplyMicroPivots" defaultChecked={a.autoApplyMicroPivots} className="mt-1 accent-[var(--accent)]" />
                  <span>
                    Apply micro-pivots automatically
                    <span className="block text-xs text-faint">Posting times, hashtags, hook tweaks. Bigger pivots always ask you first.</span>
                  </span>
                </label>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(
                  [
                    ["reelsPerWeek", "Reels / week", a.cadence.reelsPerWeek],
                    ["feedPostsPerWeek", "Feed posts / week", a.cadence.feedPostsPerWeek],
                    ["storiesPerWeek", "Stories / week", a.cadence.storiesPerWeek],
                    ["linkedinPerWeek", "LinkedIn / week", a.cadence.linkedinPerWeek],
                    ["xPerWeek", "X posts / week", a.cadence.xPerWeek],
                  ] as const
                ).map(([name, label, value]) => (
                  <Field key={name} label={label} htmlFor={name}>
                    <input id={name} name={name} type="number" min={0} max={50} className="input" defaultValue={value} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <SubmitButton className="btn-primary" pendingText="Saving…">
              Save brief
            </SubmitButton>
          </div>
        </ActionForm>
      </SectionCard>

      <SectionCard title="Content pipeline">
        <div className="flex flex-wrap gap-2">
          {CONTENT_STATUSES.filter((s) => counts[s]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <StatusPill status={s} />
              <span className="text-sm tabular-nums">{counts[s]}</span>
            </span>
          ))}
          {!Object.keys(counts).length ? <p className="text-sm text-faint">No content yet.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
