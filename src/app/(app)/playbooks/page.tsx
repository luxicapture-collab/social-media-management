import { savePlaybookAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/server/auth/dal";
import { playbooksData } from "@/server/queries";

export const metadata = { title: "Playbooks" };

const ABOUT: Record<string, string> = {
  creative: "Angles, hooks, structures, the house cinematic look and the prompt grammar for image and video generation.",
  platforms: "What each platform rewards in 2026, specs, caption rules and format choices.",
  strategy: "How the agent diagnoses performance, picks pivots and runs experiments.",
  community: "How replies are written, what's handled automatically and what's escalated to you.",
  watch: "Sources the daily watch reads and how it judges whether a change matters.",
};

export default async function PlaybooksPage() {
  await requireUser();
  const books = await playbooksData();
  return (
    <div>
      <PageHeader title="Playbooks" subtitle="The agent's working knowledge. It reads these before every plan, reply and review. Edit them freely — your changes apply from the next run. Self-updates proposed by the daily watch appear in Alerts first." />
      <div className="space-y-3">
        {books.map((b) => (
          <details key={b.key} className="card card-pad group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-semibold">{b.title}</span>
                <span className="block text-xs text-muted">{ABOUT[b.key] ?? ""}</span>
              </span>
              <span className="text-xs text-faint">
                v{b.version} · {b.source === "user" ? "edited by you" : b.source === "agent" ? "updated by the agent" : "original"} · {timeAgo(b.updatedAt)}
              </span>
            </summary>
            <ActionForm action={savePlaybookAction.bind(null, b.key)} className="mt-4 space-y-2">
              <textarea name="content" defaultValue={b.content} rows={24} className="input font-mono text-xs leading-relaxed" aria-label={`${b.title} playbook`} dir="auto" />
              <SubmitButton className="btn-sm">Save playbook</SubmitButton>
            </ActionForm>
          </details>
        ))}
      </div>
    </div>
  );
}
