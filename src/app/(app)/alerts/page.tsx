import clsx from "clsx";
import { BookOpen, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { applyProposalAction, markAlertReadAction, markAllAlertsReadAction, rejectProposalAction } from "@/app/actions";
import { ActionButton } from "@/components/forms";
import { EmptyState, ImportanceTag, PageHeader, SectionCard, timeAgo } from "@/components/ui";
import { requireUser } from "@/server/auth/dal";
import { alertsData } from "@/server/queries";

export const metadata = { title: "Alerts" };

const KIND: Record<string, string> = {
  watch: "Platform & tool updates",
  health: "Account health",
  goal: "Goal",
  credits: "Credits",
  publish: "Publishing",
  system: "System",
  community: "Community",
};

export default async function AlertsPage() {
  await requireUser();
  const { alerts, proposals } = await alertsData();
  const unread = alerts.filter((a) => !a.read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        subtitle="The daily watch reviews platform changelogs, tool updates and every client account. Important changes are pushed to your phone; the rest wait here."
        actions={unread ? <ActionButton action={markAllAlertsReadAction} className="btn-sm">Mark all read</ActionButton> : null}
      />

      {proposals.length ? (
        <SectionCard title={`Playbook updates to approve · ${proposals.length}`}>
          <p className="mb-3 text-sm text-muted">When a change affects how content should be made, the agent proposes an edit to its own playbook. Nothing changes until you apply it.</p>
          <ul className="space-y-3">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <BookOpen className="h-3.5 w-3.5 text-accent" aria-hidden />
                  <span className="font-medium text-fg">{p.summary}</span>
                  <span>· {p.key} playbook · {timeAgo(p.createdAt)}</span>
                </div>
                <p className="mt-2 text-xs text-muted">{p.reason}</p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs leading-relaxed whitespace-pre-wrap">{p.addition}</pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionButton action={applyProposalAction.bind(null, p.id)} className="btn-primary btn-sm">
                    <Check className="h-3.5 w-3.5" aria-hidden /> Apply to playbook
                  </ActionButton>
                  <ActionButton action={rejectProposalAction.bind(null, p.id)} className="btn-ghost btn-sm text-muted">
                    Reject
                  </ActionButton>
                  {p.sourceUrl ? (
                    <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm ml-auto">
                      Source <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {!alerts.length ? <EmptyState title="No alerts" body="The first daily watch runs at 07:00 agency time." /> : null}
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li key={a.id} className={clsx("card card-pad", a.read && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <ImportanceTag importance={a.importance} />
              <span className="badge">{KIND[a.kind] ?? a.kind}</span>
              {a.client ? <span>{a.client}</span> : null}
              <span>· {timeAgo(a.createdAt)}</span>
              {!a.read ? <span className="ml-auto h-2 w-2 rounded-full bg-accent" aria-label="Unread" /> : null}
            </div>
            <p className="mt-2 font-medium">{a.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{a.summary}</p>
            {a.action ? (
              <p className="mt-2 text-sm">
                <span className="text-accent">Suggested:</span> {a.action}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {a.url ? (
                a.url.startsWith("/") ? (
                  <Link href={a.url} className="btn btn-sm">
                    Open
                  </Link>
                ) : (
                  <a href={a.url} target="_blank" rel="noreferrer" className="btn btn-sm">
                    Source <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )
              ) : null}
              {!a.read ? (
                <ActionButton action={markAlertReadAction.bind(null, a.id)} className="btn-ghost btn-sm text-muted">
                  Mark read
                </ActionButton>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
