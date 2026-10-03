import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, PageHeader, PlatformChips, SectionCard, timeAgo, usd } from "@/components/ui";
import { FORMAT_LABEL, FORMATS, PLATFORM_LABEL, PLATFORMS } from "@/domain/types";
import { createScenarioAction } from "@/app/actions";
import { requireUser } from "@/server/auth/dal";
import { clientsList, scenariosList } from "@/server/queries";

export const metadata = { title: "Studio" };

const LANGUAGES = [
  ["", "Client default"],
  ["en", "English"],
  ["fa", "Farsi"],
  ["ar", "Arabic"],
  ["tr", "Turkish"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
] as const;

const SCENARIO_STATUS: Record<string, string> = {
  new: "Queued",
  planning: "Planning…",
  planned: "Concepts ready",
  failed: "Planning failed",
};

function Chip({ name, value, label }: { name: string; value: string; label: string }) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name={name} value={value} className="peer sr-only" />
      <span className="badge px-3 py-1.5 text-xs transition-colors peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-fg peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
        {label}
      </span>
    </label>
  );
}

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireUser();
  const { client: preselect } = await searchParams;
  const [clients, scenarios] = await Promise.all([clientsList(), scenariosList()]);
  const active = clients.filter((c) => c.status !== "paused");

  return (
    <div>
      <PageHeader title="Studio" subtitle="Describe the scenario. The agent explores angles, writes concepts with per-platform captions, prices the production and sends it to you to green-light." />

      {!active.length ? (
        <EmptyState
          title="No active clients"
          body="Add a client first — the agent plans for one client at a time, in their voice."
          action={
            <Link href="/clients" className="btn btn-primary btn-sm">
              Add a client
            </Link>
          }
        />
      ) : (
        <SectionCard title="New scenario" className="mb-6">
          <ActionForm action={createScenarioAction} resetOnSuccess className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <div>
                <label className="label" htmlFor="clientId">
                  Client
                </label>
                <select id="clientId" name="clientId" className="input" defaultValue={preselect ?? active[0]?.id} required>
                  {active.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="aim">
                  Aim (optional)
                </label>
                <input id="aim" name="aim" className="input" placeholder="e.g. Book discovery calls for the autumn shoot season" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="text">
                Scenario
              </label>
              <textarea
                id="text"
                name="text"
                dir="auto"
                required
                minLength={10}
                rows={5}
                className="input leading-relaxed"
                placeholder="What's happening, what you want people to feel or do, anything that must be in it. e.g. “We just wrapped a night shoot for a perfume brand on a rooftop in the rain. Show the craft behind it — lighting, the wet reflections, the crew — and invite brands to book a consultation.”"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className="label">Formats (empty = agent decides)</legend>
                <div className="flex flex-wrap gap-1.5">
                  {FORMATS.map((f) => (
                    <Chip key={f} name="formats" value={f} label={FORMAT_LABEL[f]} />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="label">Platforms (empty = all connected)</legend>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => (
                    <Chip key={p} name="platforms" value={p} label={PLATFORM_LABEL[p]} />
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <div>
                <label className="label" htmlFor="windowStart">
                  From
                </label>
                <input id="windowStart" name="windowStart" type="date" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="windowEnd">
                  To
                </label>
                <input id="windowEnd" name="windowEnd" type="date" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="count">
                  Concepts
                </label>
                <input id="count" name="count" type="number" min={1} max={8} defaultValue={3} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="language">
                  Language
                </label>
                <select id="language" name="language" className="input" defaultValue="">
                  {LANGUAGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="label" htmlFor="budgetUsd">
                  Budget $ (optional)
                </label>
                <input id="budgetUsd" name="budgetUsd" type="number" min={0} step={1} className="input" placeholder="Weekly budget" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">Nothing is generated or spent until you green-light a concept and its quote.</p>
              <SubmitButton className="btn-primary" pendingText="Sending…">
                <Sparkles className="h-4 w-4" aria-hidden /> Plan concepts
              </SubmitButton>
            </div>
          </ActionForm>
        </SectionCard>
      )}

      <h2 className="section-title">Recent scenarios</h2>
      {!scenarios.length ? <p className="text-sm text-faint">No scenarios yet.</p> : null}
      <ul className="space-y-3">
        {scenarios.map((s) => (
          <li key={s.id} className="card card-pad">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className={`badge ${s.status === "failed" ? "border-danger/40 text-danger" : s.status === "planned" ? "border-success/40 text-success" : "border-info/40 text-info"}`}>{SCENARIO_STATUS[s.status] ?? s.status}</span>
              <span className="font-medium text-fg">{s.client}</span>
              <span>· {timeAgo(s.createdAt)}</span>
              {s.platforms.length ? <PlatformChips platforms={s.platforms} /> : null}
              {s.budgetUsd ? <span>· budget {usd(s.budgetUsd)}</span> : null}
            </div>
            <p className="mt-2 line-clamp-3 text-sm" dir="auto">
              {s.text}
            </p>
            {s.agentNote ? <p className="mt-2 text-xs leading-relaxed text-muted">{s.agentNote}</p> : null}
            {s.angles.length ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-accent">Angles the agent weighed ({s.angles.length})</summary>
                <ul className="mt-2 space-y-1.5">
                  {[...s.angles]
                    .sort((a, b) => b.score - a.score)
                    .map((a) => (
                      <li key={a.angle + a.idea} className="text-xs">
                        <span className="font-medium text-fg">{a.angle.replace(/_/g, " ")}</span> <span className="text-faint tabular-nums">{a.score}/10</span>
                        <span className="text-muted"> — {a.idea}</span>
                        {a.why ? <span className="block text-faint">{a.why}</span> : null}
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
            {s.status === "planned" ? (
              <Link href="/approvals" className="mt-3 inline-block text-xs text-accent hover:underline">
                {s.conceptCount} concept{s.conceptCount === 1 ? "" : "s"} waiting in Approvals →
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
