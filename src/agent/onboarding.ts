import { z } from "zod";
import type { LLM } from "./llm";
import { ONBOARDING, identity } from "./prompts";

export const BriefDraftSchema = z.object({
  positioning: z.string(),
  services: z.string(),
  voice: z.string(),
  audience: z.string(),
  pillars: z.array(z.string()),
  visualGrammar: z.string(),
  guardrails: z.array(z.string()),
  ctas: z.array(z.string()),
  hashtags: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type BriefDraft = z.infer<typeof BriefDraftSchema>;

export async function draftBrief(llm: LLM, input: { name: string; notes: string; sourceText: string; clientId?: string }): Promise<BriefDraft> {
  return llm.structured({
    task: "onboarding.brief",
    clientId: input.clientId,
    system: [{ text: `${identity()}\n\n${ONBOARDING}`, cache: true }],
    prompt: `Client: ${input.name}\nNotes from the owner: ${input.notes || "none"}\n\n<source_material>\n${input.sourceText.slice(0, 30000) || "(no website text available)"}\n</source_material>`,
    schema: BriefDraftSchema,
    effort: "medium",
    maxTokens: 8000,
    demo: () => ({
      positioning: `${input.name}: cinematic, story-first visual work.`,
      services: "Photography, film, editing.",
      voice: "Warm, precise, quietly confident. Sample: “We don't stage the moment — we light it.”",
      audience: "Couples and brands who value craft over volume.",
      pillars: ["Behind the frame", "Before / after grading", "Client stories", "One craft lesson"],
      visualGrammar: "Photoreal cinema: anamorphic, motivated light, film grain. No CGI.",
      guardrails: ["No CGI or cheap effects", "Never show private client details without consent"],
      ctas: ["DM us your date", "Link in bio to book"],
      hashtags: ["#cinematicwedding", "#filmphotography"],
      openQuestions: ["Which services matter most this quarter?", "Any topics or competitors to avoid?"],
    }),
  });
}
