import { z } from "zod";
import { describeModelsForPlanner, type ModelEntry } from "@/domain/models";
import { CaptionsSchema, ProductionPlanSchema, type Captions, type ProductionPlan } from "@/domain/schemas";
import { renderClientBrief, renderClientState, type ClientContext } from "./context";
import type { LLM } from "./llm";
import { DIRECTOR, STRATEGIST, identity } from "./prompts";

export const RevisionOutputSchema = z.object({
  hook: z.string(),
  beats: z.array(z.string()),
  rationale: z.string(),
  captions: CaptionsSchema,
  production: ProductionPlanSchema,
  needsNewGenerations: z.boolean().describe("True when the change requires new paid renders (new shots/frames/voice/music)"),
  note: z.string().describe("What changed, in one or two sentences, plus any guardrail conflict"),
});
export type RevisionOutput = z.infer<typeof RevisionOutputSchema>;

export interface RevisionInput {
  ctx: ClientContext;
  playbooks: string;
  models: ModelEntry[];
  item: {
    title: string;
    format: string;
    platforms: string[];
    hook: string;
    beats: string[];
    rationale: string;
    captions: Captions;
    production: ProductionPlan | null;
  };
  note: string;
  stage: "concept" | "cut";
}

export async function reviseContent(llm: LLM, input: RevisionInput): Promise<RevisionOutput> {
  return llm.structured({
    task: `director.revise_${input.stage}`,
    clientId: input.ctx.client.id,
    system: [
      {
        text: `${identity()}\n\n${DIRECTOR}\n\n${STRATEGIST}\n\n<playbooks>\n${input.playbooks}\n</playbooks>\n\n<model_registry>\n${describeModelsForPlanner(input.models)}\n</model_registry>`,
        cache: true,
      },
      { text: renderClientBrief(input.ctx), cache: true },
    ],
    prompt: `${renderClientState(input.ctx)}\n\nStage: ${input.stage === "cut" ? "finished cut under review" : "concept"}\n<item>\n${JSON.stringify(input.item, null, 1)}\n</item>\n\n<revision_note from="owner">\n${input.note}\n</revision_note>`,
    schema: RevisionOutputSchema,
    effort: "high",
    maxTokens: 32000,
    demo: () => ({
      hook: input.item.hook,
      beats: input.item.beats,
      rationale: input.item.rationale,
      captions: input.item.captions,
      production: input.item.production ?? {
        aspect: "9:16",
        durationSec: 0,
        shots: [],
        frames: [],
        voiceover: null,
        music: null,
        sfx: [],
        textOverlays: [],
        burnCaptions: false,
        coverAtSec: 0,
      },
      needsNewGenerations: false,
      note: `Demo mode: noted "${input.note.slice(0, 120)}". With Claude connected the director rewrites the plan and captions to match.`,
    }),
  });
}
