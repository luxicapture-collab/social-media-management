import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { loadThread, textOf } from "@/agent/chat";
import { ChatPanel, type ChatLine } from "@/components/chat-panel";
import { PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { chatThreadsList, clientsList } from "@/server/queries";

export const metadata = { title: "Ask the agent" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  await requireUser();
  const { t } = await searchParams;
  const [threads, clients] = await Promise.all([chatThreadsList(), clientsList()]);
  const threadId = t && threads.some((x) => x.id === t) ? t : null;

  const initial: ChatLine[] = [];
  if (threadId) {
    for (const m of await loadThread(threadId)) {
      // Tool results travel as user-role messages; only show what people typed and what the agent said.
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (m.role === "user" && typeof m.content !== "string") continue;
      const text = m.role === "user" ? (m.content as string).replace(/^\[[^\]]+\]\s*/, "") : textOf(m.content);
      if (text) initial.push({ role: m.role, text });
    }
  }

  const first = clients[0]?.name;
  const suggestions = [
    "What's waiting on me today?",
    first ? `How is ${first} pacing toward the goal, and what would you change?` : "How do I set up my first client?",
    first ? `Plan 3 reels for ${first} next week around a behind-the-scenes shoot` : "What can you do?",
    "Which post performed best this month and why?",
  ];

  return (
    <div>
      <PageHeader
        title="Ask the agent"
        subtitle={config().demo ? "Demo mode: replies summarise the pipeline. Add ANTHROPIC_API_KEY to talk with the full agent." : "It sees every client, goal, post and metric, and can plan, set goals or approve when you ask."}
        actions={
          <Link href="/chat" className="btn btn-sm">
            <Plus className="h-3.5 w-3.5" aria-hidden /> New chat
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <p className="section-title">Recent</p>
          <ul className="space-y-0.5">
            {threads.map((th) => (
              <li key={th.id}>
                <Link href={`/chat?t=${th.id}`} className={clsx("block rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-2", th.id === threadId ? "bg-surface-2 text-fg" : "text-muted")}>
                  <span className="block truncate">{th.title}</span>
                  <span className="text-[11px] text-faint">{timeAgo(th.updatedAt)}</span>
                </Link>
              </li>
            ))}
            {!threads.length ? <li className="text-xs text-faint">No conversations yet.</li> : null}
          </ul>
        </aside>
        <ChatPanel key={threadId ?? "new"} threadId={threadId} initial={initial} suggestions={suggestions} />
      </div>
    </div>
  );
}
