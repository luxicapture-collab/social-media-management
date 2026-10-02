import { eq } from "drizzle-orm";
import { reviseContent } from "@/agent/director";
import { getLLM } from "@/agent/llm";
import { enforceCaptionRules } from "@/agent/strategist";
import { quoteForPlan } from "@/domain/quotes";
import type { Concept } from "@/domain/schemas";
import { logRun } from "../activity";
import { getDb } from "../db/client";
import { contentItems } from "../db/schema";
import { getModels } from "../generation/models";
import { PermanentJobError } from "../jobs/queue";
import { getKnowledgeBundle } from "../knowledge";
import { notify } from "../notify";
import { getPrices } from "../settings";
import { buildClientContext } from "./context";
import { assemble } from "./production";

/** Apply the owner's revision note (or a pivot direction) to a concept or a finished cut. */
export async function reviseItem(payload: { contentId: string }): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, payload.contentId));
  if (!item) throw new PermanentJobError("Content not found");
  if (item.status !== "revise") return { skipped: `status is ${item.status}` };
  const note = item.revisionNote ?? "Tighten it.";
  const stage = item.revisionOf === "cut" ? "cut" : "concept";
  const llm = getLLM();
  const ctx = await buildClientContext(item.clientId);
  const out = await reviseContent(llm, {
    ctx,
    playbooks: await getKnowledgeBundle(["creative", "platforms"]),
    models: await getModels(),
    note,
    stage,
    item: { title: item.title, format: item.format, platforms: item.platforms, hook: item.hook, beats: item.beats, rationale: item.rationale, captions: item.captions, production: item.production },
  });
  const conceptLike = { ...(item.concept ?? ({} as Concept)), title: item.title, format: item.format, platforms: item.platforms, hook: out.hook, captions: out.captions } as Concept;
  const { captions } = await enforceCaptionRules(llm, ctx, conceptLike);
  const quote = quoteForPlan(out.production, await getPrices(), { platforms: item.platforms, xCaption: captions.x });

  if (stage === "concept" || out.needsNewGenerations) {
    await db
      .update(contentItems)
      .set({
        status: "concept",
        hook: out.hook,
        beats: out.beats,
        rationale: out.rationale,
        captions,
        production: out.production,
        quote,
        revisionNote: null,
        revisionOf: null,
        agentNote: stage === "cut" ? `Revision needs new renders — re-quoted at $${quote.totalUsd.toFixed(2)}. ${out.note}` : out.note,
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, item.id));
    await notify({ title: `Revised: ${item.title}`, body: out.note.slice(0, 180), url: "/approvals", importance: "medium" });
  } else {
    // Edit within the approved quote: re-assemble from the existing renders.
    await db
      .update(contentItems)
      .set({ status: "producing", hook: out.hook, beats: out.beats, captions, production: out.production, agentNote: out.note, updatedAt: new Date() })
      .where(eq(contentItems.id, item.id));
    await assemble(item.id);
  }
  await logRun({ kind: "revise", clientId: item.clientId, summary: `Revised "${item.title}" (${stage}): ${out.note}`.slice(0, 500), details: { contentId: item.id } });
  return { stage, newRenders: out.needsNewGenerations };
}
