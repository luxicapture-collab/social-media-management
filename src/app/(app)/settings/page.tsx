import clsx from "clsx";
import { CheckCircle2, CircleDashed, LogOut, Play } from "lucide-react";
import { logoutAction, runJobNowAction, saveModelsAction, saveNotificationsAction, savePricesAction, toggleScheduleAction } from "@/app/actions";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { InstallHint, PushToggle } from "@/components/pwa";
import { PageHeader, SectionCard, timeAgo, usd } from "@/components/ui";
import { formatLocal } from "@/domain/time";
import { requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { DEFAULT_SCHEDULES } from "@/server/jobs/scheduler";
import { settingsData } from "@/server/queries";

export const metadata = { title: "Settings" };

const INTEGRATION_LABEL: Record<string, string> = {
  claude: "Claude (the agent's brain)",
  higgsfield: "Higgsfield — images & video",
  elevenlabs: "ElevenLabs — voice, music, SFX",
  meta: "Meta — Instagram & Facebook",
  linkedin: "LinkedIn",
  x: "X",
  metricool: "Metricool route",
  storage: "Public media hosting",
  push: "Phone & desktop push",
  telegram: "Telegram",
};

const RUNNABLE = new Set(["agent.sweep", "watch.daily", "metrics.daily", "metrics.posts", "community.sync", "review.weekly", "production.advance", "publish.due"]);

export default async function SettingsPage() {
  const user = await requireUser();
  const d = await settingsData();
  const tz = config().agencyTimezone;
  const describe = new Map(DEFAULT_SCHEDULES.map((s) => [s.name, s.description]));
  const totalUsd = d.usage.reduce((a, u) => a + u.usd, 0);
  const n = d.notifications;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle={`Signed in as ${user.email}`} />

      <SectionCard title="Integrations">
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {Object.entries(d.integrations).map(([key, v]) => (
            <li key={key} className="flex items-start gap-2.5">
              {v.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Ready" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-label="Not set up" />}
              <span className="min-w-0">
                <span className="block text-sm">{INTEGRATION_LABEL[key] ?? key}</span>
                <span className="block truncate text-xs text-muted">{v.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-faint">Keys live in the server environment (.env). See docs/SETUP.md for each platform&apos;s app setup and the permissions to request.</p>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Notifications">
          <div className="space-y-3">
            <PushToggle publicKey={d.pushPublicKey} />
            <InstallHint />
          </div>
          <ActionForm action={saveNotificationsAction} className="mt-5 space-y-3 border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="push" defaultChecked={n.push} className="accent-[var(--accent)]" /> Push notifications
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="telegram" defaultChecked={n.telegram} className="accent-[var(--accent)]" /> Telegram messages
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="morningBrief" defaultChecked={n.morningBrief} className="accent-[var(--accent)]" /> Morning brief after the daily watch
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="minImportance">
                  Notify for
                </label>
                <select id="minImportance" name="minImportance" defaultValue={n.minImportance} className="input">
                  <option value="high">High only</option>
                  <option value="medium">Medium and up</option>
                  <option value="info">Everything</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="quietStart">
                  Quiet from
                </label>
                <input id="quietStart" name="quietStart" type="number" min={0} max={23} defaultValue={n.quietHours?.start ?? ""} className="input" placeholder="23" />
              </div>
              <div>
                <label className="label" htmlFor="quietEnd">
                  Quiet until
                </label>
                <input id="quietEnd" name="quietEnd" type="number" min={0} max={23} defaultValue={n.quietHours?.end ?? ""} className="input" placeholder="7" />
              </div>
            </div>
            <p className="text-xs text-faint">Quiet hours use {tz}. High-importance alerts always come through.</p>
            <SubmitButton className="btn-sm">Save notifications</SubmitButton>
          </ActionForm>
        </SectionCard>

        <SectionCard title="Usage · last 30 days">
          <p className="kpi">{usd(totalUsd)}</p>
          <p className="mb-3 text-xs text-muted">Claude usage. Generation spend is tracked per piece against its quote.</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {d.usage
                .sort((a, b) => b.usd - a.usd)
                .map((u) => (
                  <tr key={u.task}>
                    <td className="py-1.5">{u.task}</td>
                    <td className="py-1.5 text-right text-xs text-muted tabular-nums">{u.calls} calls</td>
                    <td className="py-1.5 text-right tabular-nums">{usd(u.usd)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!d.usage.length ? <p className="text-sm text-faint">No usage yet.</p> : null}
          <p className="mt-4 text-xs text-muted">
            Job queue:{" "}
            {d.queue.length
              ? d.queue
                  .map((q) => `${q.n} ${q.status}`)
                  .sort()
                  .join(" · ")
              : "empty"}
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Agent schedule">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-1 pb-2 font-medium">Routine</th>
                <th className="px-1 pb-2 font-medium">When</th>
                <th className="px-1 pb-2 font-medium">Last run</th>
                <th className="px-1 pb-2 font-medium">Next</th>
                <th className="px-1 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.schedules.map((s) => (
                <tr key={s.name} className={clsx(!s.enabled && "opacity-60")}>
                  <td className="px-1 py-2">
                    <span className="block font-medium">{s.name}</span>
                    <span className="block text-xs text-muted">{describe.get(s.name) ?? s.jobType}</span>
                  </td>
                  <td className="px-1 py-2 font-mono text-xs text-muted">
                    {s.cron}
                    <span className="block font-sans">{s.timezone}</span>
                  </td>
                  <td className="px-1 py-2 text-xs text-muted">{timeAgo(s.lastRunAt)}</td>
                  <td className="px-1 py-2 text-xs text-muted">{s.nextRunAt && s.enabled ? formatLocal(s.nextRunAt, tz) : "–"}</td>
                  <td className="px-1 py-2">
                    <span className="flex justify-end gap-1">
                      {RUNNABLE.has(s.jobType) ? (
                        <ActionButton action={runJobNowAction.bind(null, s.jobType)} className="btn-ghost btn-sm text-muted">
                          <Play className="h-3.5 w-3.5" aria-hidden /> Run now
                        </ActionButton>
                      ) : null}
                      <ActionButton action={toggleScheduleAction.bind(null, s.name, !s.enabled)} className="btn-sm">
                        {s.enabled ? "Pause" : "Enable"}
                      </ActionButton>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.schedules.length ? <p className="text-sm text-faint">Schedules are created when the worker first starts.</p> : null}
      </SectionCard>

      <SectionCard title="Daily watch sources">
        <ul className="divide-y divide-border text-sm">
          {d.sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="badge">{s.scope}</span>
              <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                {s.name}
              </a>
              <span className="ml-auto text-xs text-faint">
                {s.lastError ? <span className="text-danger">{s.lastError.slice(0, 60)}</span> : s.lastCheckedAt ? `checked ${timeAgo(s.lastCheckedAt)}` : "not checked yet"}
                {s.lastChangedAt ? ` · changed ${timeAgo(s.lastChangedAt)}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {!d.sources.length ? <p className="text-sm text-faint">Sources are added on the first daily watch.</p> : null}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Generation models">
          <p className="mb-3 text-xs text-muted">Which Higgsfield endpoint the director uses for each role, and how inputs map. Edit when Higgsfield adds or renames models.</p>
          <ActionForm action={saveModelsAction} className="space-y-2">
            <textarea name="models" rows={16} defaultValue={JSON.stringify(d.models, null, 2)} className="input font-mono text-xs" aria-label="Model registry JSON" spellCheck={false} />
            <SubmitButton className="btn-sm">Save models</SubmitButton>
          </ActionForm>
        </SectionCard>
        <SectionCard title="Price table">
          <p className="mb-3 text-xs text-muted">Unit prices used for quotes before green-light. Keep them close to your plan&apos;s real credit costs.</p>
          <ActionForm action={savePricesAction} className="space-y-2">
            <textarea name="prices" rows={16} defaultValue={JSON.stringify(d.prices, null, 2)} className="input font-mono text-xs" aria-label="Price table JSON" spellCheck={false} />
            <SubmitButton className="btn-sm">Save prices</SubmitButton>
          </ActionForm>
        </SectionCard>
      </div>

      <form action={logoutAction}>
        <button type="submit" className="btn btn-ghost text-muted">
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </form>
    </div>
  );
}
