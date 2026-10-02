import { and, desc, eq } from "drizzle-orm";
import { slugify } from "@/domain/text";
import { isValidTimeZone } from "@/domain/time";
import { DEFAULT_AUTONOMY, DEFAULT_BRIEF, type ClientAutonomy, type ClientBrief, type GoalKpi, type Platform } from "@/domain/types";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { clients, goals } from "../db/schema";
import { logRun } from "../activity";

export interface ClientInput {
  name: string;
  timezone?: string;
  languages?: string[];
  website?: string | null;
  industry?: string | null;
  brief?: Partial<ClientBrief>;
  autonomy?: Partial<ClientAutonomy>;
  status?: "onboarding" | "active" | "paused";
}

export async function createClient(input: ClientInput): Promise<string> {
  const db = await getDb();
  let id = slugify(input.name, 32);
  const existing = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id));
  if (existing.length) id = `${id}-${newId().slice(0, 4)}`;
  const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  await db.insert(clients).values({
    id,
    name: input.name.trim(),
    status: input.status ?? "active",
    timezone: tz,
    languages: input.languages?.length ? input.languages : ["en"],
    website: input.website ?? null,
    industry: input.industry ?? null,
    brief: { ...DEFAULT_BRIEF, ...(input.brief ?? {}) },
    autonomy: { ...DEFAULT_AUTONOMY, ...(input.autonomy ?? {}), cadence: { ...DEFAULT_AUTONOMY.cadence, ...(input.autonomy?.cadence ?? {}) } },
  });
  await logRun({ kind: "onboard", clientId: id, summary: `Added client ${input.name}.` });
  return id;
}

export async function updateClient(id: string, input: Partial<ClientInput>): Promise<void> {
  const db = await getDb();
  const [current] = await db.select().from(clients).where(eq(clients.id, id));
  if (!current) throw new Error("Client not found");
  await db
    .update(clients)
    .set({
      name: input.name?.trim() || current.name,
      status: input.status ?? current.status,
      timezone: input.timezone && isValidTimeZone(input.timezone) ? input.timezone : current.timezone,
      languages: input.languages?.length ? input.languages : current.languages,
      website: input.website === undefined ? current.website : input.website,
      industry: input.industry === undefined ? current.industry : input.industry,
      brief: { ...current.brief, ...(input.brief ?? {}) },
      autonomy: {
        ...current.autonomy,
        ...(input.autonomy ?? {}),
        cadence: { ...current.autonomy.cadence, ...(input.autonomy?.cadence ?? {}) },
      },
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id));
}

export async function listClients() {
  const db = await getDb();
  return db.select().from(clients).orderBy(clients.name);
}

export async function getClient(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(clients).where(eq(clients.id, id));
  return c;
}

export interface GoalInput {
  statement: string;
  kpi: GoalKpi;
  platform?: Platform | null;
  target: number;
  baseline?: number | null;
  startDate?: Date;
  deadline: Date;
}

/** Setting a goal archives the previous active goal. */
export async function setGoal(clientId: string, input: GoalInput): Promise<string> {
  const db = await getDb();
  await db.update(goals).set({ status: "archived", updatedAt: new Date() }).where(and(eq(goals.clientId, clientId), eq(goals.status, "active")));
  const id = newId("goal");
  await db.insert(goals).values({
    id,
    clientId,
    statement: input.statement.trim(),
    kpi: input.kpi,
    platform: input.platform ?? null,
    target: input.target,
    baseline: input.baseline ?? null,
    startDate: input.startDate ?? new Date(),
    deadline: input.deadline,
  });
  await logRun({ kind: "goal", clientId, summary: `New goal: ${input.statement}` });
  return id;
}

export async function goalHistory(clientId: string) {
  const db = await getDb();
  return db.select().from(goals).where(eq(goals.clientId, clientId)).orderBy(desc(goals.createdAt));
}
