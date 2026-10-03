import clsx from "clsx";
import { EyeOff, ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { hideInboxAction, sendReplyAction, skipInboxAction } from "@/app/actions";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, PageHeader, PlatformGlyph, TextDir, timeAgo } from "@/components/ui";
import { PLATFORM_LABEL } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { inboxData } from "@/server/queries";

export const metadata = { title: "Inbox" };

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "text-info border-info/40" },
  drafted: { label: "Draft ready", cls: "text-accent border-accent/40" },
  needs_you: { label: "Needs you", cls: "text-warning border-warning/40" },
  sent: { label: "Replied", cls: "text-success border-success/40" },
  hidden: { label: "Hidden", cls: "text-faint" },
  skipped: { label: "Skipped", cls: "text-faint" },
  failed: { label: "Send failed", cls: "text-danger border-danger/40" },
};

const CATEGORY: Record<string, string> = {
  question: "Question",
  praise: "Praise",
  lead: "Lead",
  complaint: "Complaint",
  spam: "Spam",
  sensitive: "Sensitive",
  other: "Other",
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireUser();
  const { f } = await searchParams;
  const filter = f === "all" || f === "sent" ? f : "attention";
  const items = await inboxData(filter);
  const tabs = [
    ["attention", "Needs attention"],
    ["sent", "Handled"],
    ["all", "All"],
  ] as const;

  return (
    <div>
      <PageHeader title="Inbox" subtitle="Comments, DMs and mentions across every client. The agent answers routine ones in the client's voice and brings you leads, complaints and anything sensitive." />
      <nav className="mb-4 flex gap-1" aria-label="Filter">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/inbox?f=${k}`} className={clsx("btn btn-sm", filter === k && "border-accent text-fg")}>
            {label}
          </Link>
        ))}
      </nav>

      {!items.length ? <EmptyState title={filter === "attention" ? "All caught up" : "Nothing here yet"} body="New comments and messages are checked every 10 minutes (instantly with Meta webhooks)." /> : null}

      <ul className="space-y-3">
        {items.map((m) => {
          const s = STATUS[m.status] ?? STATUS.new;
          const open = ["needs_you", "drafted", "failed", "new"].includes(m.status);
          return (
            <li key={m.id} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm">
                    <PlatformGlyph platform={m.platform} className="text-muted" />
                    <span className="font-medium">{m.authorName ?? m.authorHandle ?? "Someone"}</span>
                    {m.authorHandle && m.authorName && m.authorHandle !== m.authorName ? <span className="text-xs text-muted">@{m.authorHandle.replace(/^@/, "")}</span> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {m.kind === "dm" ? "DM" : m.kind === "mention" ? "Mention" : "Comment"} on {PLATFORM_LABEL[m.platform]} · {m.client} · {timeAgo(m.receivedAt)}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <span className={clsx("badge", s.cls)}>{s.label}</span>
                  {m.category ? <span className="badge">{CATEGORY[m.category] ?? m.category}</span> : null}
                </div>
              </div>
              {m.postTitle ? <p className="mt-1 text-xs text-faint">On “{m.postTitle}”</p> : null}
              <p className="mt-2 text-sm leading-relaxed">
                <TextDir text={m.text} />
              </p>
              {m.agentNote ? <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{m.agentNote}</p> : null}
              {m.repliedAt && m.reply ? (
                <p className="mt-2 border-l-2 border-success/50 pl-3 text-sm text-muted">
                  <span className="block text-[11px] text-faint">Agent replied {timeAgo(m.repliedAt)}</span>
                  <TextDir text={m.reply} />
                </p>
              ) : null}
              {open ? (
                <ActionForm action={sendReplyAction.bind(null, m.id)} className="mt-3 space-y-2">
                  <textarea
                    name="text"
                    rows={3}
                    dir="auto"
                    className="input"
                    defaultValue={m.repliedAt ? "" : (m.reply ?? "")}
                    placeholder={m.repliedAt ? "Follow up personally — sent as another reply…" : "Write a reply in the client's voice…"}
                    aria-label="Reply"
                  />
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton className="btn-primary btn-sm" pendingText="Sending…">
                      <Send className="h-3.5 w-3.5" aria-hidden /> Send reply
                    </SubmitButton>
                    {m.kind === "comment" ? (
                      <ActionButton action={hideInboxAction.bind(null, m.id)} className="btn-sm" confirm="Hide this comment on the platform?">
                        <EyeOff className="h-3.5 w-3.5" aria-hidden /> Hide
                      </ActionButton>
                    ) : null}
                    <ActionButton action={skipInboxAction.bind(null, m.id)} className="btn-ghost btn-sm text-muted">
                      {m.repliedAt ? "Mark done" : "No reply needed"}
                    </ActionButton>
                    {m.permalink ? (
                      <a href={m.permalink} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm ml-auto">
                        Open <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </ActionForm>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
