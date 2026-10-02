import { z } from "zod";
import { supportsFormat } from "@/domain/platform-specs";
import { AngleSchema, CaptionsSchema, ConceptSchema, type Captions, type Concept } from "@/domain/schemas";
import { describeModelsForPlanner, type ModelEntry } from "@/domain/models";
import { isoWithOffset } from "@/domain/time";
import type { Format, Platform } from "@/domain/types";
import { hasBlockingIssues, validateCaption, findCliches, type CaptionIssue } from "@/domain/captions";
import { renderClientBrief, renderClientState, type ClientContext } from "./context";
import { demoCaptionsFix, demoPlan, demoReview } from "./demo";
import type { LLM } from "./llm";
import { COPY_FIXER, CRITIC, STRATEGIST, identity } from "./prompts";

export const ScoredAngleSchema = z.object({
  angle: AngleSchema,
  idea: z.string(),
  goalFit: z.number(),
  novelty: z.number(),
  cost: z.number(),
  platformFit: z.number(),
  why: z.string(),
});

export const PlanOutputSchema = z.object({
  angles: z.array(ScoredAngleSchema).describe("At least five angles considered, scored 1-10"),
  concepts: z.array(ConceptSchema),
  planNote: z.string().describe("What you chose and why, any guardrail adaptations, anything the owner should know"),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

export const ReviewOutputSchema = z.object({
  reviews: z.array(z.object({ title: z.string(), score: z.number(), notes: z.array(z.string()) })),
  concepts: z.array(ConceptSchema),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export interface ScenarioInput {
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

export interface PlanInput {
  ctx: ClientContext;
  scenario: ScenarioInput;
  models: ModelEntry[];
  playbooks: string;
}

function systemParts(input: { ctx: ClientContext; playbooks: string; models: ModelEntry[] }, role: string) {
  return [
    {
      text: `${identity()}\n\n${role}\n\n<playbooks>\n${input.playbooks}\n</playbooks>\n\n<model_registry>\n${describeModelsForPlanner(input.models)}\n</model_registry>`,
      cache: true,
    },
    { text: renderClientBrief(input.ctx), cache: true },
  ];
}

function scenarioBlock(s: ScenarioInput, tz: string): string {
  return `<scenario>
${s.text}
</scenario>
Requested formats: ${s.formats.length ? s.formats.join(", ") : "your choice"}
Requested platforms: ${s.platforms.length ? s.platforms.join(", ") : "all connected"}
Window: ${s.windowStart ? isoWithOffset(s.windowStart, tz) : "from now"} → ${s.windowEnd ? isoWithOffset(s.windowEnd, tz) : "next 7 days"}
Aim: ${s.aim || "serve the client goal"}
Language: ${s.language || "client default"}
Budget for this scenario: ${s.budgetUsd ? `$${s.budgetUsd}` : "within the weekly budget"}
Number of concepts: ${s.count ?? 3}`;
}

/** Keep only platform/format combinations that exist. */
export function sanitizeConcept(c: Concept, allowedPlatforms: Platform[]): Concept {
  const platforms = c.platforms.filter((p) => supportsFormat(p, c.format) && (allowedPlatforms.length === 0 || allowedPlatforms.includes(p)));
  const captions: Captions = { ...c.captions };
  for (const p of ["instagram", "facebook", "linkedin", "x"] as const) {
    if (!platforms.includes(p)) captions[p] = "";
  }
  return { ...c, platforms: platforms.length ? platforms : c.platforms.filter((p) => supportsFormat(p, c.format)), captions };
}

export async function planScenario(llm: LLM, input: PlanInput): Promise<PlanOutput> {
  const out = await llm.structured({
    task: "strategist.plan",
    clientId: input.ctx.client.id,
    system: systemParts(input, STRATEGIST),
    prompt: `${renderClientState(input.ctx)}\n\n${scenarioBlock(input.scenario, input.ctx.client.timezone)}\n\nPlan it.`,
    schema: PlanOutputSchema,
    effort: "high",
    maxTokens: 64000,
    demo: () => demoPlan(input),
  });
  return { ...out, concepts: out.concepts.map((c) => sanitizeConcept(c, input.scenario.platforms)) };
}

export async function reviewConcepts(
  llm: LLM,
  input: { ctx: ClientContext; concepts: Concept[]; playbooks: string; models: ModelEntry[] },
): Promise<ReviewOutput> {
  const out = await llm.structured({
    task: "critic.review",
    clientId: input.ctx.client.id,
    system: systemParts(input, CRITIC),
    prompt: `${renderClientState(input.ctx)}\n\n<draft_concepts>\n${JSON.stringify(input.concepts, null, 1)}\n</draft_concepts>\n\nReview and improve.`,
    schema: ReviewOutputSchema,
    effort: "high",
    maxTokens: 64000,
    demo: () => demoReview(input.concepts),
  });
  return out;
}

export function captionIssues(concept: Pick<Concept, "captions" | "platforms" | "format">): Partial<Record<Platform, CaptionIssue[]>> {
  const issues: Partial<Record<Platform, CaptionIssue[]>> = {};
  for (const p of concept.platforms) {
    const found = validateCaption(p, concept.captions[p] ?? "", { format: concept.format });
    if (found.length) issues[p] = found;
  }
  return issues;
}

function needsFix(issues: Partial<Record<Platform, CaptionIssue[]>>): boolean {
  return Object.values(issues).some((list) => list && (hasBlockingIssues(list) || list.some((i) => i.code === "cliche" || i.code === "too_many_hashtags")));
}

/**
 * Validate captions against the platform rules and let Claude fix what fails (two rounds max).
 * Returns the final captions and any issues that remain (surfaced on the concept card).
 */
export async function enforceCaptionRules(
  llm: LLM,
  ctx: ClientContext,
  concept: Concept,
): Promise<{ captions: Captions; remaining: Partial<Record<Platform, CaptionIssue[]>> }> {
  let captions = concept.captions;
  let issues = captionIssues({ ...concept, captions });
  for (let round = 0; round < 2 && needsFix(issues); round++) {
    const issueText = Object.entries(issues)
      .map(([p, list]) => `${p}:\n${(list ?? []).map((i) => `  - [${i.severity}] ${i.message}`).join("\n")}`)
      .join("\n");
    captions = await llm.structured({
      task: "copy.fix",
      clientId: ctx.client.id,
      system: [{ text: `${identity()}\n\n${COPY_FIXER}`, cache: true }, { text: renderClientBrief(ctx), cache: true }],
      prompt: `Content: "${concept.title}" (${concept.format}, hook: ${concept.hook})\n\n<captions>\n${JSON.stringify(captions, null, 1)}\n</captions>\n\n<issues>\n${issueText}\n</issues>`,
      schema: CaptionsSchema,
      effort: "medium",
      maxTokens: 8000,
      demo: () => demoCaptionsFix(captions),
    });
    issues = captionIssues({ ...concept, captions });
  }
  return { captions, remaining: issues };
}

export function clicheCount(c: Captions): number {
  return Object.values(c).reduce((n, text) => n + findCliches(text).length, 0);
}
