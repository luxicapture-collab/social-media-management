"use client";

import clsx from "clsx";
import { ArrowUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface ChatLine {
  role: "user" | "assistant";
  text: string;
}

/** Conversation with the agent. It can look things up and act (plan, set goals, approve…) when asked. */
export function ChatPanel({ threadId: initialThread, initial, suggestions }: { threadId: string | null; initial: ChatLine[]; suggestions: string[] }) {
  const [threadId, setThreadId] = useState(initialThread);
  const [lines, setLines] = useState<ChatLine[]>(initial);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, pending]);

  async function send(message: string) {
    const body = message.trim();
    if (!body || pending) return;
    setError(null);
    setLines((l) => [...l, { role: "user", text: body }]);
    setText("");
    setPending(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, text: body }) });
      const json = (await res.json().catch(() => ({}))) as { threadId?: string; reply?: string; error?: string };
      if (!res.ok || !json.reply) throw new Error(json.error ?? `Request failed (${res.status})`);
      setLines((l) => [...l, { role: "assistant", text: json.reply! }]);
      if (json.threadId && json.threadId !== threadId) {
        setThreadId(json.threadId);
        window.history.replaceState(null, "", `/chat?t=${json.threadId}`);
        router.refresh(); // show the new conversation in the Recent list
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-4 pb-4" aria-live="polite">
        {!lines.length ? (
          <div className="card card-pad">
            <p className="text-sm text-muted">Ask about any client, give a scenario, set a goal or ask what needs you. The agent can look things up and act when you ask it to.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" className="btn btn-sm text-left" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {lines.map((l, i) => (
          <div key={i} className={clsx("flex", l.role === "user" ? "justify-end" : "justify-start")}>
            <div
              dir="auto"
              className={clsx(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                l.role === "user" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md border border-border bg-surface",
              )}
            >
              {l.text}
            </div>
          </div>
        ))}
        {pending ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Thinking — this can take a moment when it looks things up.
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>
      <form
        className="sticky bottom-20 flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-accent/70 lg:bottom-4"
        style={{ boxShadow: "var(--shadow)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={1}
          dir="auto"
          placeholder="Message the agent…"
          aria-label="Message"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <button type="submit" className="btn btn-primary h-10 w-10 shrink-0 p-0" disabled={pending || !text.trim()} aria-label="Send">
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
