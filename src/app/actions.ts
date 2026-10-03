"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { draftBrief } from "@/agent/onboarding";
import { getLLM } from "@/agent/llm";
import type { ModelEntry } from "@/domain/models";
import type { PriceTable } from "@/domain/quotes";
import type { Captions } from "@/domain/schemas";
import { htmlToText } from "@/domain/text";
import { zonedToUtc } from "@/domain/time";
import { FORMATS, GOAL_KPIS, PLATFORMS, type Platform } from "@/domain/types";
import { endSession, requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { newId } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { alerts, clients, inboxItems, pushSubscriptions, schedules } from "@/server/db/schema";
import { saveModels } from "@/server/generation/models";
import { enqueue } from "@/server/jobs/queue";
import { applyKnowledgeProposal, rejectKnowledgeProposal, updateKnowledge, KNOWLEDGE_KEYS, type KnowledgeKey } from "@/server/knowledge";
import { hideInboxItem, sendInboxReply } from "@/server/pipeline/community";
import { markManualPublished } from "@/server/pipeline/publishing";
import { finishOAuth } from "@/server/platforms/oauth";
import { getClient, createClient, setGoal, updateClient } from "@/server/services/clients";
import { connectDemoAccounts, deleteConnection, saveConnection, setConnectionRoute } from "@/server/services/connections";
import * as content from "@/server/services/content";
import { setSetting, type NotificationPrefs } from "@/server/settings";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const lines = (fd: FormData, k: string) =>
  str(fd, k)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Interpret a datetime-local value in the client's time zone. */
function localToUtc(value: string, tz: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return zonedToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] }, tz);
}

// ------------------------------------------------------------------ session

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

// ------------------------------------------------------------------ clients

export async function createClientAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const name = str(fd, "name");
  if (!name) return { error: "Give the client a name." };
  const id = await createClient({
    name,
    timezone: str(fd, "timezone") || "UTC",
    languages: str(fd, "languages").split(/[,\s]+/).filter(Boolean),
    website: str(fd, "website") || null,
    industry: str(fd, "industry") || null,
  });
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function updateClientAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  await updateClient(clientId, {
    name: str(fd, "name"),
    status: (str(fd, "status") as "onboarding" | "active" | "paused") || undefined,
    timezone: str(fd, "timezone"),
    languages: str(fd, "languages").split(/[,\s]+/).filter(Boolean),
    website: str(fd, "website") || null,
    industry: str(fd, "industry") || null,
    brief: {
      positioning: str(fd, "positioning"),
      services: str(fd, "services"),
      voice: str(fd, "voice"),
      audience: str(fd, "audience"),
      pillars: lines(fd, "pillars"),
      visualGrammar: str(fd, "visualGrammar"),
      guardrails: lines(fd, "guardrails"),
      ctas: lines(fd, "ctas"),
      hashtags: str(fd, "hashtags").split(/\s+/).filter((h) => h.startsWith("#")),
      competitors: lines(fd, "competitors"),
      notes: str(fd, "notes"),
    },
    autonomy: {
      replies: (str(fd, "replies") as "auto" | "draft" | "off") || "auto",
      autoApplyMicroPivots: fd.get("autoApplyMicroPivots") === "on",
      weeklyBudgetUsd: Number(str(fd, "weeklyBudgetUsd") || 150),
      aiDisclosureText: str(fd, "aiDisclosureText"),
      cadence: {
        reelsPerWeek: Number(str(fd, "reelsPerWeek") || 3),
        feedPostsPerWeek: Number(str(fd, "feedPostsPerWeek") || 2),
        storiesPerWeek: Number(str(fd, "storiesPerWeek") || 7),
        linkedinPerWeek: Number(str(fd, "linkedinPerWeek") || 2),
        xPerWeek: Number(str(fd, "xPerWeek") || 3),
      },
    },
  });
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Saved." };
}

const GoalForm = z.object({
  statement: z.string().min(3),
  kpi: z.enum(GOAL_KPIS),
  platform: z.union([z.enum(PLATFORMS), z.literal("")]),
  target: z.coerce.number().positive(),
  baseline: z.union([z.coerce.number(), z.literal("")]),
  deadline: z.string().min(8),
});

export async function setGoalAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = GoalForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Fill in the goal statement, KPI, target and deadline." };
  const g = parsed.data;
  await setGoal(clientId, {
    statement: g.statement,
    kpi: g.kpi,
    platform: g.platform || null,
    target: g.target,
    baseline: g.baseline === "" ? null : g.baseline,
    deadline: new Date(`${g.deadline}T23:59:00Z`),
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
  return { ok: true, message: "Goal set. The agent paces against it from tomorrow's KPI check." };
}

export async function draftBriefAction(clientId: string): Promise<ActionState> {
  await requireUser();
  const client = await getClient(clientId);
  if (!client) return { error: "Client not found" };
  let sourceText = "";
  if (client.website) {
    try {
      const res = await fetch(client.website, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "LuxiSocialAgent/1.0" } });
      if (res.ok) sourceText = htmlToText(await res.text()).slice(0, 30000);
    } catch {
      // continue without the site
    }
  }
  const draft = await draftBrief(getLLM(), { name: client.name, notes: client.brief.notes, sourceText, clientId });
  const b = client.brief;
  await updateClient(clientId, {
    brief: {
      positioning: b.positioning || draft.positioning,
      services: b.services || draft.services,
      voice: b.voice || draft.voice,
      audience: b.audience || draft.audience,
      pillars: b.pillars.length ? b.pillars : draft.pillars,
      visualGrammar: b.visualGrammar || draft.visualGrammar,
      guardrails: b.guardrails.length ? b.guardrails : draft.guardrails,
      ctas: b.ctas.length ? b.ctas : draft.ctas,
      hashtags: b.hashtags.length ? b.hashtags : draft.hashtags,
      notes: [b.notes, draft.openQuestions.length ? `Open questions:\n- ${draft.openQuestions.join("\n- ")}` : ""].filter(Boolean).join("\n\n"),
    },
  });
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Draft added to the empty fields. Review and edit before planning." };
}

export async function connectDemoAction(clientId: string): Promise<void> {
  await requireUser();
  await connectDemoAccounts(clientId, [...PLATFORMS]);
  revalidatePath(`/clients/${clientId}`);
}

export async function disconnectAction(clientId: string, platform: Platform | "metricool"): Promise<void> {
  await requireUser();
  await deleteConnection(clientId, platform);
  revalidatePath(`/clients/${clientId}`);
}

export async function setRouteAction(clientId: string, platform: Platform, route: "direct" | "metricool"): Promise<void> {
  await requireUser();
  await setConnectionRoute(clientId, platform, route);
  revalidatePath(`/clients/${clientId}`);
}

export async function saveMetricoolAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const blogId = str(fd, "blogId");
  const userId = str(fd, "userId") || config().metricool.userId || "";
  const token = str(fd, "token") || config().metricool.userToken || "";
  if (!blogId || !userId || !token) return { error: "Brand id (blogId), user id and API token are all required (user id and token can come from METRICOOL_USER_ID / METRICOOL_USER_TOKEN)." };
  await saveConnection({ clientId, platform: "metricool", accountId: blogId, accountName: `Metricool brand ${blogId}`, accessToken: token, meta: { userId } });
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Metricool brand saved. Switch any platform's route to Metricool below." };
}

export async function finishConnectAction(state: string, key: string): Promise<void> {
  await requireUser();
  const { clientId } = await finishOAuth(state, key);
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?connected=1`);
}

// ------------------------------------------------------------------ scenarios & content

export async function createScenarioAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const clientId = str(fd, "clientId");
  const text = str(fd, "text");
  if (!clientId || text.length < 10) return { error: "Pick a client and describe the scenario (a sentence or more)." };
  const client = await getClient(clientId);
  if (!client) return { error: "Client not found" };
  const formats = fd.getAll("formats").map(String).filter((f): f is (typeof FORMATS)[number] => (FORMATS as readonly string[]).includes(f));
  const platforms = fd.getAll("platforms").map(String).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
  await content.createScenario({
    clientId,
    text,
    formats,
    platforms,
    windowStart: str(fd, "windowStart") ? localToUtc(`${str(fd, "windowStart")}T00:00`, client.timezone) : null,
    windowEnd: str(fd, "windowEnd") ? localToUtc(`${str(fd, "windowEnd")}T23:59`, client.timezone) : null,
    aim: str(fd, "aim") || null,
    language: str(fd, "language") || null,
    budgetUsd: str(fd, "budgetUsd") ? Number(str(fd, "budgetUsd")) : null,
    count: Number(str(fd, "count") || 3),
  });
  revalidatePath("/studio");
  return { ok: true, message: "Got it. The agent is planning — concepts land in Approvals in a minute or two." };
}

function refresh(id?: string) {
  revalidatePath("/approvals");
  revalidatePath("/calendar");
  revalidatePath("/");
  if (id) revalidatePath(`/content/${id}`);
}

export async function greenlightAction(id: string): Promise<void> {
  await requireUser();
  await content.greenlight(id);
  refresh(id);
}

export async function reviseAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const note = str(fd, "note");
  if (note.length < 3) return { error: "Write what to change." };
  await content.requestRevision(id, note);
  refresh(id);
  return { ok: true, message: "Sent to the agent." };
}

export async function dropAction(id: string): Promise<void> {
  await requireUser();
  await content.drop(id);
  refresh(id);
}

export async function restoreAction(id: string): Promise<void> {
  await requireUser();
  await content.restore(id);
  refresh(id);
}

export async function approveAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const detail = await import("@/server/queries").then((q) => q.contentDetail(id));
  if (!detail) return { error: "Not found" };
  const captions: Partial<Captions> = {};
  for (const p of PLATFORMS) if (fd.has(`caption_${p}`)) captions[p] = String(fd.get(`caption_${p}`) ?? "");
  const when = str(fd, "scheduledAt");
  const scheduledAt = when ? localToUtc(when, detail.client.timezone) : detail.item.scheduledAt;
  await content.approve(id, { captions, scheduledAt });
  refresh(id);
  return { ok: true, message: "Approved. Scheduling now." };
}

export async function unscheduleAction(id: string): Promise<void> {
  await requireUser();
  await content.unschedule(id);
  refresh(id);
}

export async function retryAction(id: string): Promise<void> {
  await requireUser();
  await content.retryFailed(id);
  refresh(id);
}

export async function saveCaptionsAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const captions: Partial<Captions> = {};
  for (const p of PLATFORMS) if (fd.has(`caption_${p}`)) captions[p] = String(fd.get(`caption_${p}`) ?? "");
  await content.updateCaptions(id, captions);
  refresh(id);
  return { ok: true, message: "Captions saved." };
}

export async function rescheduleAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const detail = await import("@/server/queries").then((q) => q.contentDetail(id));
  if (!detail) return { error: "Not found" };
  const at = localToUtc(str(fd, "scheduledAt"), detail.client.timezone);
  if (!at) return { error: "Pick a date and time." };
  await content.reschedule(id, at);
  refresh(id);
  return { ok: true, message: "Time updated." };
}

export async function markPostedAction(publicationId: string, contentId: string): Promise<void> {
  await requireUser();
  await markManualPublished(publicationId);
  refresh(contentId);
}

// ------------------------------------------------------------------ inbox & alerts

export async function sendReplyAction(inboxId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const text = str(fd, "text");
  if (!text) return { error: "Write a reply." };
  const r = await sendInboxReply(inboxId, text);
  revalidatePath("/inbox");
  return r.ok ? { ok: true, message: "Sent." } : { error: r.error ?? "Failed to send" };
}

export async function hideInboxAction(inboxId: string): Promise<void> {
  await requireUser();
  await hideInboxItem(inboxId);
  revalidatePath("/inbox");
}

export async function skipInboxAction(inboxId: string): Promise<void> {
  await requireUser();
  const db = await getDb();
  await db.update(inboxItems).set({ status: "skipped", updatedAt: new Date() }).where(eq(inboxItems.id, inboxId));
  revalidatePath("/inbox");
}

export async function markAlertReadAction(id: string): Promise<void> {
  await requireUser();
  const db = await getDb();
  await db.update(alerts).set({ read: true }).where(eq(alerts.id, id));
  revalidatePath("/alerts");
}

export async function markAllAlertsReadAction(): Promise<void> {
  await requireUser();
  const db = await getDb();
  await db.update(alerts).set({ read: true }).where(eq(alerts.read, false));
  revalidatePath("/alerts");
}

export async function applyProposalAction(id: string): Promise<void> {
  await requireUser();
  await applyKnowledgeProposal(id);
  revalidatePath("/alerts");
  revalidatePath("/playbooks");
}

export async function rejectProposalAction(id: string): Promise<void> {
  await requireUser();
  await rejectKnowledgeProposal(id);
  revalidatePath("/alerts");
}

// ------------------------------------------------------------------ settings

export async function savePlaybookAction(key: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  if (!(KNOWLEDGE_KEYS as readonly string[]).includes(key)) return { error: "Unknown playbook" };
  await updateKnowledge(key as KnowledgeKey, str(fd, "content"), "user");
  revalidatePath("/playbooks");
  return { ok: true, message: "Playbook saved. The agent uses it from the next run." };
}

export async function saveModelsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  try {
    const models = JSON.parse(str(fd, "models")) as ModelEntry[];
    if (!Array.isArray(models) || models.some((m) => !m.key || !m.endpoint || !m.kind)) return { error: "Each model needs key, kind and endpoint." };
    await saveModels(models);
  } catch (err) {
    return { error: `Invalid JSON: ${(err as Error).message}` };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Model registry saved." };
}

export async function savePricesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  try {
    const prices = JSON.parse(str(fd, "prices")) as PriceTable;
    await setSetting("prices", prices);
  } catch (err) {
    return { error: `Invalid JSON: ${(err as Error).message}` };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Prices saved. New quotes use them." };
}

export async function saveNotificationsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const start = str(fd, "quietStart");
  const end = str(fd, "quietEnd");
  const prefs: NotificationPrefs = {
    push: fd.get("push") === "on",
    telegram: fd.get("telegram") === "on",
    minImportance: (str(fd, "minImportance") as NotificationPrefs["minImportance"]) || "medium",
    morningBrief: fd.get("morningBrief") === "on",
    quietHours: start !== "" && end !== "" ? { start: Number(start), end: Number(end) } : null,
  };
  await setSetting("notifications", prefs);
  revalidatePath("/settings");
  return { ok: true, message: "Notification settings saved." };
}

export async function toggleScheduleAction(name: string, enabled: boolean): Promise<void> {
  await requireUser();
  const db = await getDb();
  await db.update(schedules).set({ enabled }).where(eq(schedules.name, name));
  revalidatePath("/settings");
}

const RUNNABLE = ["agent.sweep", "watch.daily", "metrics.daily", "metrics.posts", "community.sync", "review.weekly", "production.advance", "publish.due"] as const;

export async function runJobNowAction(type: string): Promise<void> {
  await requireUser();
  if (!(RUNNABLE as readonly string[]).includes(type)) return;
  await enqueue(type, { manual: true }, { dedupeKey: `manual:${type}:${Math.floor(Date.now() / 60_000)}` });
  revalidatePath("/settings");
}

export async function savePushSubscriptionAction(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string): Promise<{ ok: boolean }> {
  await requireUser();
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false };
  const db = await getDb();
  await db
    .insert(pushSubscriptions)
    .values({ id: newId("psh"), endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent.slice(0, 300) })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  return { ok: true };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<void> {
  await requireUser();
  const db = await getDb();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function setClientStatusAction(clientId: string, status: "active" | "paused"): Promise<void> {
  await requireUser();
  const db = await getDb();
  await db.update(clients).set({ status, updatedAt: new Date() }).where(eq(clients.id, clientId));
  revalidatePath(`/clients/${clientId}`);
}

export async function loadDemoDataAction(): Promise<void> {
  await requireUser();
  if (!config().demo) return;
  const { seedDemo } = await import("@/server/demo/seed");
  await seedDemo();
  revalidatePath("/", "layout");
}
