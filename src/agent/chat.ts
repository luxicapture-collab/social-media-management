import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { FORMATS, GOAL_KPIS, PLATFORMS, type ContentStatus } from "@/domain/types";
import { config } from "@/server/config";
import { newId } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { alerts, chatMessages, chatThreads, clients, contentItems, inboxItems } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { buildClientContext, postSamples } from "@/server/pipeline/context";
import { listClients, setGoal, updateClient } from "@/server/services/clients";
import { approve, createScenario, drop, greenlight, requestRevision } from "@/server/services/content";
import { engagementRate } from "@/domain/analytics";
import { anthropicClient, modelRequestBase, recordUsage } from "./llm";
import { chatSystem } from "./prompts";

const json = (v: unknown) => JSON.stringify(v, null, 1);

async function overview(clientId: string) {
  const ctx = await buildClientContext(clientId);
  const db = await getDb();
  const items = await db.select({ status: contentItems.status }).from(contentItems).where(eq(contentItems.clientId, clientId));
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  return {
    client: ctx.client.name,
    goal: ctx.goal ? { statement: ctx.goal.statement, current: ctx.goal.current, target: ctx.goal.target, pace: ctx.goal.pace, read: ctx.goal.agentRead } : null,
    pace: ctx.pace,
    bottleneck: ctx.diagnosis?.bottleneck ?? null,
    evidence: ctx.diagnosis?.evidence ?? [],
    experiments: ctx.experiments,
    contentByStatus: counts,
    connected: ctx.connected,
  };
}

/** Tools the chat agent can use. Mutating tools only run when the owner asked for that action. */
export function chatTools() {
  return [
    betaZodTool({
      name: "list_clients",
      description: "List all clients with id, name, status and time zone.",
      inputSchema: z.object({}),
      run: async () => json((await listClients()).map((c) => ({ id: c.id, name: c.name, status: c.status, timezone: c.timezone }))),
    }),
    betaZodTool({
      name: "client_overview",
      description: "Goal, pace, diagnosed bottleneck, running experiments and content pipeline counts for one client.",
      inputSchema: z.object({ clientId: z.string() }),
      run: async ({ clientId }) => json(await overview(clientId)),
    }),
    betaZodTool({
      name: "performance",
      description: "Published posts with their metrics for a client over the last N days (default 30), best first by reach.",
      inputSchema: z.object({ clientId: z.string(), days: z.number().int().optional() }),
      run: async ({ clientId, days }) => {
        const s = await postSamples(clientId, days ?? 30);
        return json(
          s
            .sort((a, b) => (b.metrics.reach ?? 0) - (a.metrics.reach ?? 0))
            .slice(0, 25)
            .map((p) => ({ title: p.title, platform: p.platform, format: p.format, date: p.publishedAt.toISOString().slice(0, 10), ...p.metrics, engagementRate: engagementRate(p.metrics) })),
        );
      },
    }),
    betaZodTool({
      name: "list_content",
      description: "Content items for a client, optionally filtered by status (concept, greenlit, producing, review, approved, scheduled, live, analyzed, revise, dropped, failed).",
      inputSchema: z.object({ clientId: z.string(), status: z.string().optional() }),
      run: async ({ clientId, status }) => {
        const db = await getDb();
        const rows = await db
          .select({ id: contentItems.id, title: contentItems.title, format: contentItems.format, status: contentItems.status, platforms: contentItems.platforms, scheduledAt: contentItems.scheduledAt, quote: contentItems.quote })
          .from(contentItems)
          .where(and(eq(contentItems.clientId, clientId), status ? eq(contentItems.status, status as ContentStatus) : undefined))
          .orderBy(desc(contentItems.createdAt))
          .limit(30);
        return json(rows.map((r) => ({ ...r, quoteUsd: r.quote?.totalUsd })));
      },
    }),
    betaZodTool({
      name: "get_content",
      description: "Full details of one content item: hook, beats, rationale, captions per platform, production plan, quote, performance.",
      inputSchema: z.object({ contentId: z.string() }),
      run: async ({ contentId }) => {
        const db = await getDb();
        const [row] = await db.select().from(contentItems).where(eq(contentItems.id, contentId));
        return row ? json({ ...row, concept: undefined }) : "Not found";
      },
    }),
    betaZodTool({
      name: "create_scenario",
      description: "Create a scenario for a client; the agent plans concepts from it in the background (no spend until green-light).",
      inputSchema: z.object({
        clientId: z.string(),
        text: z.string(),
        formats: z.array(z.enum(FORMATS)).optional(),
        platforms: z.array(z.enum(PLATFORMS)).optional(),
        count: z.number().int().optional(),
        language: z.string().optional(),
        windowStart: z.string().optional().describe("ISO date-time"),
        windowEnd: z.string().optional().describe("ISO date-time"),
        budgetUsd: z.number().optional(),
      }),
      run: async (i) => {
        const id = await createScenario({
          clientId: i.clientId,
          text: i.text,
          formats: i.formats ?? [],
          platforms: i.platforms ?? [],
          count: i.count,
          language: i.language,
          windowStart: i.windowStart ? new Date(i.windowStart) : null,
          windowEnd: i.windowEnd ? new Date(i.windowEnd) : null,
          budgetUsd: i.budgetUsd,
        });
        return `Scenario ${id} created; planning has started. Concepts will appear in Approvals.`;
      },
    }),
    betaZodTool({
      name: "set_goal",
      description: "Set (replace) the active goal for a client.",
      inputSchema: z.object({
        clientId: z.string(),
        statement: z.string(),
        kpi: z.enum(GOAL_KPIS),
        target: z.number(),
        deadline: z.string().describe("ISO date"),
        platform: z.enum(PLATFORMS).optional(),
        baseline: z.number().optional(),
      }),
      run: async (g) => {
        const id = await setGoal(g.clientId, { statement: g.statement, kpi: g.kpi, target: g.target, deadline: new Date(g.deadline), platform: g.platform ?? null, baseline: g.baseline ?? null });
        return `Goal ${id} set.`;
      },
    }),
    betaZodTool({
      name: "update_brief",
      description: "Update parts of a client's brief (voice, audience, pillars, guardrails, CTAs, hashtags, notes...). Only when the owner asks.",
      inputSchema: z.object({
        clientId: z.string(),
        voice: z.string().optional(),
        audience: z.string().optional(),
        positioning: z.string().optional(),
        pillars: z.array(z.string()).optional(),
        guardrails: z.array(z.string()).optional(),
        ctas: z.array(z.string()).optional(),
        hashtags: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
      run: async ({ clientId, ...brief }) => {
        const clean = Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== undefined));
        await updateClient(clientId, { brief: clean });
        return `Brief updated: ${Object.keys(clean).join(", ")}.`;
      },
    }),
    betaZodTool({
      name: "decide",
      description: "Act on a content item ONLY when the owner explicitly asked: greenlight (starts paid production at the quoted cost), approve (schedules a finished cut), revise (with a note), or drop.",
      inputSchema: z.object({ contentId: z.string(), action: z.enum(["greenlight", "approve", "revise", "drop"]), note: z.string().optional() }),
      run: async ({ contentId, action, note }) => {
        if (action === "greenlight") await greenlight(contentId);
        else if (action === "approve") await approve(contentId);
        else if (action === "revise") await requestRevision(contentId, note ?? "Revise per chat.");
        else await drop(contentId, note);
        return `Done: ${action} on ${contentId}.`;
      },
    }),
    betaZodTool({
      name: "run_analysis",
      description: "Queue a fresh diagnose-and-pivot analysis for a client now.",
      inputSchema: z.object({ clientId: z.string() }),
      run: async ({ clientId }) => {
        await enqueue("strategy.analyze", { clientId, mode: "daily" }, { dedupeKey: `chat-analysis:${clientId}:${new Date().toISOString().slice(0, 13)}` });
        return "Analysis queued; results land in Analytics and the activity feed within a few minutes.";
      },
    }),
    betaZodTool({
      name: "waiting_on_me",
      description: "Everything waiting on the owner: concepts to green-light, cuts to review, messages that need a human, unread high alerts.",
      inputSchema: z.object({}),
      run: async () => {
        const db = await getDb();
        const items = await db
          .select({ id: contentItems.id, title: contentItems.title, status: contentItems.status, clientId: contentItems.clientId })
          .from(contentItems)
          .where(inArray(contentItems.status, ["concept", "review"]));
        const inbox = await db.select({ id: inboxItems.id, text: inboxItems.text, platform: inboxItems.platform }).from(inboxItems).where(eq(inboxItems.status, "needs_you"));
        const high = await db.select({ title: alerts.title }).from(alerts).where(and(eq(alerts.importance, "high"), eq(alerts.read, false)));
        return json({ items, inbox, alerts: high });
      },
    }),
  ];
}

async function nextSeq(threadId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ m: max(chatMessages.seq) }).from(chatMessages).where(eq(chatMessages.threadId, threadId));
  return (row?.m ?? -1) + 1;
}

export async function loadThread(threadId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const db = await getDb();
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(asc(chatMessages.seq));
  return rows.map((r) => ({ role: r.role, content: r.content as Anthropic.Beta.BetaMessageParam["content"] }));
}

export function textOf(content: Anthropic.Beta.BetaMessageParam["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function demoReply(userText: string): Promise<string> {
  const db = await getDb();
  const all = await db.select().from(clients);
  if (!all.length) return "No clients yet. Add one on the Clients screen, then give me a scenario in the Studio.";
  const lines: string[] = [];
  for (const c of all) {
    const o = await overview(c.id);
    lines.push(`• ${c.name}: ${o.goal ? `${o.goal.statement} — ${o.goal.pace.replace("_", " ")}` : "no goal yet"}; pipeline ${Object.entries(o.contentByStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "empty"}.`);
  }
  return `Demo mode (no ANTHROPIC_API_KEY), so I can only summarise. You asked: "${userText.slice(0, 120)}".\n\n${lines.join("\n")}\n\nAdd an API key to chat with the full agent.`;
}

/** One chat turn. History is stored verbatim (thinking + tool blocks) and replayed append-only. */
export async function chatTurn(threadId: string | null, userText: string): Promise<{ threadId: string; reply: string }> {
  const db = await getDb();
  let id = threadId;
  if (!id) {
    id = newId("thr");
    await db.insert(chatThreads).values({ id, title: userText.slice(0, 80) });
  }
  const history = await loadThread(id);
  const userMessage: Anthropic.Beta.BetaMessageParam = { role: "user", content: `[${new Date().toISOString()}] ${userText}` };
  let seq = await nextSeq(id);
  await db.insert(chatMessages).values({ id: newId("msg"), threadId: id, seq: seq++, role: "user", content: userMessage.content });

  if (config().demo || !config().claude.apiKey) {
    const reply = await demoReply(userText);
    await db.insert(chatMessages).values({ id: newId("msg"), threadId: id, seq: seq++, role: "assistant", content: [{ type: "text", text: reply }] });
    return { threadId: id, reply };
  }

  const messages = [...history, userMessage];
  const runner = anthropicClient().beta.messages.toolRunner({
    ...modelRequestBase("medium"),
    max_tokens: 16000,
    max_iterations: 12,
    system: [{ type: "text", text: chatSystem(), cache_control: { type: "ephemeral" } }],
    tools: chatTools(),
    messages,
  });
  let final: Anthropic.Beta.BetaMessage | undefined;
  for await (const message of runner) {
    final = message;
    await recordUsage("chat", message.model, null, message.usage);
  }
  const added = runner.params.messages.slice(messages.length);
  for (const m of added) {
    await db.insert(chatMessages).values({ id: newId("msg"), threadId: id, seq: seq++, role: m.role, content: m.content as unknown });
  }
  await db.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, id));
  const reply = final?.stop_reason === "refusal" ? "I can't help with that request." : final ? textOf(final.content as Anthropic.Beta.BetaMessageParam["content"]) : "";
  return { threadId: id, reply: reply || "Done." };
}
