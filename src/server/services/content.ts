import { and, eq, inArray } from "drizzle-orm";
import { assertTransition, isHumanTransition } from "@/domain/lifecycle";
import type { Captions } from "@/domain/schemas";
import type { ContentStatus, Format, Platform } from "@/domain/types";
import { logRun } from "../activity";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { contentItems, publications, scenarios } from "../db/schema";
import { enqueue } from "../jobs/queue";

async function load(id: string) {
  const db = await getDb();
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, id));
  if (!item) throw new Error("Content not found");
  return item;
}

async function move(id: string, to: ContentStatus, patch: Partial<typeof contentItems.$inferInsert> = {}): Promise<void> {
  const item = await load(id);
  assertTransition(item.status, to);
  if (!isHumanTransition(item.status, to)) throw new Error(`"${item.status}" → "${to}" is not a human action`);
  const db = await getDb();
  await db.update(contentItems).set({ ...patch, status: to, updatedAt: new Date() }).where(eq(contentItems.id, id));
}

/** Green-light a concept and its quote: production (and spend) starts. */
export async function greenlight(id: string): Promise<void> {
  const item = await load(id);
  await move(id, "greenlit");
  await enqueue("content.produce", { contentId: id }, { dedupeKey: `produce:${id}` });
  await logRun({ kind: "decision", clientId: item.clientId, summary: `Green-lit "${item.title}" (quote $${item.quote?.totalUsd.toFixed(2) ?? "?"}).` });
}

export async function requestRevision(id: string, note: string): Promise<void> {
  const item = await load(id);
  const revisionOf = item.status === "review" ? "cut" : "concept";
  await move(id, "revise", { revisionNote: note.trim().slice(0, 4000), revisionOf });
  await enqueue("content.revise", { contentId: id }, { dedupeKey: `revise:${id}` });
  await logRun({ kind: "decision", clientId: item.clientId, summary: `Revision requested on "${item.title}": ${note.slice(0, 120)}` });
}

export async function drop(id: string, reason?: string): Promise<void> {
  const item = await load(id);
  await move(id, "dropped", { agentNote: reason ? `Dropped: ${reason}` : item.agentNote });
  const db = await getDb();
  await db
    .update(publications)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(publications.contentId, id), inArray(publications.status, ["pending", "scheduled"])));
}

export async function restore(id: string): Promise<void> {
  await move(id, "concept");
}

/** Approve a finished cut (optionally with final caption/time edits): scheduling starts. */
export async function approve(id: string, edits: { captions?: Partial<Captions>; scheduledAt?: Date | null } = {}): Promise<void> {
  const item = await load(id);
  await move(id, "approved", {
    captions: edits.captions ? { ...item.captions, ...edits.captions } : item.captions,
    scheduledAt: edits.scheduledAt === undefined ? item.scheduledAt : edits.scheduledAt,
  });
  await enqueue("content.schedule", { contentId: id }, { dedupeKey: `schedule:${id}` });
  await logRun({ kind: "decision", clientId: item.clientId, summary: `Approved "${item.title}" for scheduling.` });
}

/** Pull a scheduled item back for edits (cancels its pending publications). */
export async function unschedule(id: string): Promise<void> {
  await move(id, "review");
  const db = await getDb();
  await db
    .update(publications)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(publications.contentId, id), inArray(publications.status, ["pending", "scheduled"])));
}

export async function retryFailed(id: string): Promise<void> {
  const item = await load(id);
  if (item.status !== "failed") throw new Error("Only failed items can be retried");
  const target: ContentStatus = item.media.length ? "review" : "greenlit";
  const db = await getDb();
  await db.update(contentItems).set({ status: target, updatedAt: new Date() }).where(eq(contentItems.id, id));
  if (target === "greenlit") await enqueue("content.produce", { contentId: id }, { dedupeKey: `produce:${id}` });
}

export async function updateCaptions(id: string, captions: Partial<Captions>): Promise<void> {
  const item = await load(id);
  if (!["concept", "review", "approved"].includes(item.status)) throw new Error("Captions can only be edited before scheduling");
  const db = await getDb();
  await db.update(contentItems).set({ captions: { ...item.captions, ...captions }, updatedAt: new Date() }).where(eq(contentItems.id, id));
}

export async function reschedule(id: string, at: Date): Promise<void> {
  const item = await load(id);
  if (!["concept", "greenlit", "producing", "review", "approved"].includes(item.status)) throw new Error("Unschedule the item first");
  const db = await getDb();
  await db.update(contentItems).set({ scheduledAt: at, updatedAt: new Date() }).where(eq(contentItems.id, id));
}

export interface ScenarioInput {
  clientId: string;
  text: string;
  formats: Format[];
  platforms: Platform[];
  windowStart?: Date | null;
  windowEnd?: Date | null;
  aim?: string | null;
  language?: string | null;
  budgetUsd?: number | null;
  count?: number;
}

/** Morteza's input: a scenario. Planning starts immediately in the background. */
export async function createScenario(input: ScenarioInput): Promise<string> {
  const db = await getDb();
  const id = newId("scn");
  await db.insert(scenarios).values({
    id,
    clientId: input.clientId,
    text: input.text.trim(),
    formats: input.formats,
    platforms: input.platforms,
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
    aim: input.aim ?? null,
    language: input.language ?? null,
    budgetUsd: input.budgetUsd ?? null,
    conceptCount: Math.max(1, Math.min(8, input.count ?? 3)),
  });
  await enqueue("scenario.plan", { scenarioId: id }, { dedupeKey: `plan:${id}` });
  return id;
}
