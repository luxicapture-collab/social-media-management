import { and, eq, inArray } from "drizzle-orm";
import { enforceCaptionRules, planScenario, reviewConcepts } from "@/agent/strategist";
import { getLLM } from "@/agent/llm";
import { pickSlot, normalizeScheduledAt, type ExistingPost } from "@/domain/scheduling";
import { quoteForPlan } from "@/domain/quotes";
import type { Concept } from "@/domain/schemas";
import { slugify } from "@/domain/text";
import { localDateKey } from "@/domain/time";
import type { Platform } from "@/domain/types";
import { logRun } from "../activity";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { contentItems, publications, scenarios } from "../db/schema";
import { getModels } from "../generation/models";
import { PermanentJobError } from "../jobs/queue";
import { getKnowledgeBundle } from "../knowledge";
import { errorMessage } from "../log";
import { notify } from "../notify";
import { getPrices } from "../settings";
import { buildClientContext } from "./context";

/** Everything already on the calendar for a client (for slot rules). */
export async function existingSchedule(clientId: string): Promise<ExistingPost[]> {
  const db = await getDb();
  const pubs = await db
    .select({ at: publications.scheduledAt, platform: publications.platform, contentId: publications.contentId })
    .from(publications)
    .where(and(eq(publications.clientId, clientId), inArray(publications.status, ["pending", "scheduled", "publishing", "published"])));
  const items = await db
    .select({ id: contentItems.id, format: contentItems.format, at: contentItems.scheduledAt, platforms: contentItems.platforms, status: contentItems.status })
    .from(contentItems)
    .where(and(eq(contentItems.clientId, clientId), inArray(contentItems.status, ["concept", "greenlit", "producing", "review", "approved"])));
  const formatById = new Map(items.map((i) => [i.id, i.format]));
  const out: ExistingPost[] = pubs.map((p) => ({ at: p.at, platform: p.platform, format: formatById.get(p.contentId) ?? "post" }));
  for (const i of items) if (i.at) for (const p of i.platforms) out.push({ at: i.at, platform: p, format: i.format });
  return out;
}

function parseLocalIso(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function contentId(clientId: string, title: string, at: Date | null, tz: string): string {
  const day = at ? localDateKey(at, tz).replace(/-/g, "") : new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${slugify(clientId, 20)}-${day}-${slugify(title, 28)}-${newId().slice(0, 4)}`;
}

/** Turn a scenario into reviewed, captioned, quoted concepts waiting for green-light. */
export async function planScenarioJob(payload: { scenarioId: string }): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, payload.scenarioId));
  if (!scenario) throw new PermanentJobError(`Scenario ${payload.scenarioId} not found`);
  if (scenario.status === "planned") return { skipped: "already planned" };
  await db.update(scenarios).set({ status: "planning", updatedAt: new Date() }).where(eq(scenarios.id, scenario.id));

  const started = new Date();
  try {
    const llm = getLLM();
    const ctx = await buildClientContext(scenario.clientId);
    const models = await getModels();
    const playbooks = await getKnowledgeBundle(["creative", "platforms", "strategy"]);
    const input = {
      ctx,
      models,
      playbooks,
      scenario: {
        text: scenario.text,
        formats: scenario.formats,
        platforms: scenario.platforms,
        windowStart: scenario.windowStart,
        windowEnd: scenario.windowEnd,
        aim: scenario.aim,
        language: scenario.language,
        budgetUsd: scenario.budgetUsd,
        count: scenario.conceptCount > 0 ? scenario.conceptCount : 3,
      },
    };
    const plan = await planScenario(llm, input);
    const reviewed = await reviewConcepts(llm, { ctx, concepts: plan.concepts, playbooks, models });
    const concepts: Concept[] = reviewed.concepts.length ? reviewed.concepts : plan.concepts;
    const prices = await getPrices();
    const schedule = await existingSchedule(scenario.clientId);
    const now = new Date();
    const tz = ctx.client.timezone;
    let total = 0;
    const created: string[] = [];

    for (const [i, concept] of concepts.entries()) {
      const { captions, remaining } = await enforceCaptionRules(llm, ctx, concept);
      const platforms = concept.platforms as Platform[];
      const quote = quoteForPlan(concept.production, prices, { platforms, xCaption: captions.x });
      total += quote.totalUsd;

      // Proposed time: the strategist's if legal, otherwise the best open slot in the window.
      const primary = platforms[0] ?? "instagram";
      const requested = parseLocalIso(concept.scheduledAt);
      const slotReq = { platform: primary, format: concept.format, tz, now, windowStart: scenario.windowStart ?? undefined, windowEnd: scenario.windowEnd ?? undefined, existing: schedule, minLeadMinutes: 6 * 60 };
      const at = requested ? normalizeScheduledAt(requested, slotReq).at : pickSlot(slotReq);
      if (at) for (const p of platforms) schedule.push({ at, platform: p, format: concept.format });

      const review = reviewed.reviews.find((r) => r.title === concept.title) ?? reviewed.reviews[i];
      const notes: string[] = [];
      const leftover = Object.entries(remaining).flatMap(([p, list]) => (list ?? []).filter((x) => x.severity === "error").map((x) => `${p}: ${x.message}`));
      if (leftover.length) notes.push(`Caption issues to check: ${leftover.join("; ")}`);
      if (scenario.budgetUsd && total > scenario.budgetUsd) notes.push(`Running total $${total.toFixed(2)} is over the scenario budget ($${scenario.budgetUsd}).`);

      const id = contentId(scenario.clientId, concept.title, at, tz);
      await db.insert(contentItems).values({
        id,
        clientId: scenario.clientId,
        scenarioId: scenario.id,
        title: concept.title,
        angle: concept.angle,
        format: concept.format,
        platforms,
        status: "concept",
        hook: concept.hook,
        beats: concept.beats,
        rationale: concept.rationale,
        captions,
        storyFrames: concept.storyFrames,
        firstComments: concept.firstComments,
        production: concept.production,
        quote,
        language: concept.production.voiceover?.language ?? scenario.language ?? ctx.client.languages[0] ?? "en",
        trialReel: concept.trialReel && platforms.includes("instagram") && concept.format === "reel",
        experimentId: concept.experimentTag || null,
        critique: review ? { score: review.score, notes: review.notes } : null,
        scheduledAt: at,
        agentNote: notes.join(" ") || null,
        concept,
      });
      created.push(id);
    }

    await db
      .update(scenarios)
      .set({
        status: "planned",
        conceptCount: created.length,
        angles: plan.angles.map((a) => ({ angle: a.angle, idea: a.idea, score: Math.round((a.goalFit + a.novelty + a.cost + a.platformFit) * 2.5), why: a.why })),
        agentNote: plan.planNote,
        updatedAt: new Date(),
      })
      .where(eq(scenarios.id, scenario.id));

    await logRun({
      kind: "plan",
      clientId: scenario.clientId,
      summary: `Planned ${created.length} concepts from ${plan.angles.length} angles for "${scenario.text.slice(0, 60)}" (quotes total $${total.toFixed(2)}).`,
      details: { scenarioId: scenario.id, content: created, llm: llm.mode },
      startedAt: started,
    });
    await notify({
      title: `${created.length} concepts ready for ${ctx.client.name}`,
      body: `Green-light or revise them. Total quote $${total.toFixed(2)}.`,
      url: "/approvals",
      importance: "medium",
      tag: `plan:${scenario.id}`,
    });
    return { created: created.length, totalUsd: total };
  } catch (err) {
    await db.update(scenarios).set({ status: "failed", agentNote: errorMessage(err).slice(0, 1000), updatedAt: new Date() }).where(eq(scenarios.id, scenario.id));
    await logRun({ kind: "plan", clientId: scenario.clientId, ok: false, summary: `Planning failed: ${errorMessage(err)}`, startedAt: started });
    throw err;
  }
}
