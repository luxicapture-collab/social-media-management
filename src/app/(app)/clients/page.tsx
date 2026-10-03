import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { createClientAction } from "@/app/actions";
import { Field, TimezoneInput } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, PacePill, PageHeader, PlatformGlyph, SectionCard } from "@/components/ui";
import { GOAL_KPI_LABEL, PLATFORM_LABEL, PLATFORMS } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { clientsList } from "@/server/queries";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requireUser();
  const clients = await clientsList();

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" subtitle="Each client has its own brief, voice, connected accounts, goal and autonomy settings." />

      {!clients.length ? <EmptyState title="No clients yet" body="Add one below. You can draft the brief from their website with one click." /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {clients.map((c) => (
          <Link key={c.id} href={`/clients/${c.id}`} className="card card-pad block transition-colors hover:border-accent/50">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="text-xs text-muted">
                  {c.industry ? `${c.industry} · ` : ""}
                  {c.timezone}
                </p>
              </div>
              <span className={clsx("badge", c.status === "active" ? "text-success border-success/40" : c.status === "paused" ? "text-faint" : "text-accent border-accent/40")}>{c.status}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => {
                const conn = c.connections.find((x) => x.platform === p);
                return (
                  <span
                    key={p}
                    className={clsx("badge", !conn ? "border-dashed text-faint" : conn.status === "connected" ? "text-fg" : "text-danger border-danger/40")}
                    title={`${PLATFORM_LABEL[p]}: ${conn ? `${conn.status}${conn.mode === "demo" ? " (demo)" : ""}` : "not connected"}`}
                  >
                    <PlatformGlyph platform={p} />
                    {conn ? (conn.status === "connected" ? (conn.mode === "demo" ? "Demo" : "Live") : conn.status) : "—"}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 border-t border-border pt-3 text-xs">
              {c.goal ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted">
                    {GOAL_KPI_LABEL[c.goal.kpi]} → {c.goal.target.toLocaleString()}
                  </span>
                  <PacePill pace={c.goal.pace} />
                </div>
              ) : (
                <span className="text-faint">No goal set</span>
              )}
            </div>
          </Link>
        ))}
      </div>

      <SectionCard title="Add a client">
        <ActionForm action={createClientAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" htmlFor="name">
            <input id="name" name="name" required className="input" placeholder="Client or brand name" />
          </Field>
          <Field label="Time zone" htmlFor="timezone" hint="Posts are scheduled in this zone.">
            <TimezoneInput defaultValue={config().agencyTimezone} />
          </Field>
          <Field label="Languages" htmlFor="languages" hint="Comma separated, e.g. en, fa">
            <input id="languages" name="languages" className="input" defaultValue="en" />
          </Field>
          <Field label="Website" htmlFor="website">
            <input id="website" name="website" type="url" className="input" placeholder="https://" />
          </Field>
          <Field label="Industry" htmlFor="industry">
            <input id="industry" name="industry" className="input" placeholder="e.g. Fragrance, real estate, hospitality" />
          </Field>
          <div className="flex items-end">
            <SubmitButton className="btn-primary w-full" pendingText="Creating…">
              <Plus className="h-4 w-4" aria-hidden /> Add client
            </SubmitButton>
          </div>
        </ActionForm>
      </SectionCard>
    </div>
  );
}
