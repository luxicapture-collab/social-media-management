import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { newId } from "./crypto";
import { getDb } from "./db/client";
import { knowledge, knowledgeProposals } from "./db/schema";

export const KNOWLEDGE_KEYS = ["creative", "platforms", "strategy", "community", "watch"] as const;
export type KnowledgeKey = (typeof KNOWLEDGE_KEYS)[number];

const TITLES: Record<KnowledgeKey, string> = {
  creative: "Creative playbook",
  platforms: "Platform rules",
  strategy: "Strategy and pivots",
  community: "Community policy",
  watch: "Daily watch",
};

function playbookDir(): string {
  return path.join(process.cwd(), "playbooks");
}

async function readSeed(key: KnowledgeKey): Promise<string> {
  try {
    return await fs.readFile(path.join(playbookDir(), `${key}.md`), "utf8");
  } catch {
    return `# ${TITLES[key]}\n`;
  }
}

/** Seed missing playbooks into the database (never overwrites edited copies). */
export async function ensureKnowledge(): Promise<void> {
  const db = await getDb();
  const existing = new Set((await db.select({ key: knowledge.key }).from(knowledge)).map((r) => r.key));
  for (const key of KNOWLEDGE_KEYS) {
    if (existing.has(key)) continue;
    await db
      .insert(knowledge)
      .values({ key, title: TITLES[key], content: await readSeed(key), source: "seed" })
      .onConflictDoNothing();
  }
}

export async function getKnowledge(key: KnowledgeKey): Promise<string> {
  await ensureKnowledge();
  const db = await getDb();
  const [row] = await db.select().from(knowledge).where(eq(knowledge.key, key));
  return row?.content ?? "";
}

export async function getKnowledgeBundle(keys: readonly KnowledgeKey[]): Promise<string> {
  const parts = await Promise.all(keys.map(async (k) => `<playbook name="${k}">\n${await getKnowledge(k)}\n</playbook>`));
  return parts.join("\n\n");
}

export async function updateKnowledge(key: KnowledgeKey, content: string, source = "user"): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(knowledge).where(eq(knowledge.key, key));
  await db
    .insert(knowledge)
    .values({ key, title: TITLES[key], content, source, version: 1 })
    .onConflictDoUpdate({
      target: knowledge.key,
      set: { content, source, version: (row?.version ?? 0) + 1, updatedAt: new Date() },
    });
}

export async function proposeKnowledgeUpdate(input: {
  key: KnowledgeKey;
  summary: string;
  addition: string;
  reason: string;
  sourceUrl?: string;
}): Promise<string> {
  const db = await getDb();
  const id = newId("kp");
  await db.insert(knowledgeProposals).values({ id, ...input, sourceUrl: input.sourceUrl ?? null });
  return id;
}

/** Apply an approved proposal: the addition is appended under "## Updates" with a date stamp. */
export async function applyKnowledgeProposal(id: string): Promise<void> {
  const db = await getDb();
  const [p] = await db.select().from(knowledgeProposals).where(eq(knowledgeProposals.id, id));
  if (!p || p.status !== "pending") return;
  const key = p.key as KnowledgeKey;
  const current = await getKnowledge(key);
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `\n- **${stamp}** — ${p.addition.trim()}${p.sourceUrl ? ` ([source](${p.sourceUrl}))` : ""}\n`;
  const next = current.includes("## Updates") ? `${current.trimEnd()}\n${entry}` : `${current.trimEnd()}\n\n## Updates\n${entry}`;
  await updateKnowledge(key, next, "self-update");
  await db.update(knowledgeProposals).set({ status: "applied", decidedAt: new Date() }).where(eq(knowledgeProposals.id, id));
}

export async function rejectKnowledgeProposal(id: string): Promise<void> {
  const db = await getDb();
  await db.update(knowledgeProposals).set({ status: "rejected", decidedAt: new Date() }).where(eq(knowledgeProposals.id, id));
}
