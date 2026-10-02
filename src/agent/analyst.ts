import { z } from "zod";
import { BOTTLENECKS } from "@/domain/types";
import { renderClientBrief, renderClientState, type ClientContext } from "./context";
import type { LLM } from "./llm";
import { ANALYST, identity } from "./prompts";

export const AnalysisSchema = z.object({
  goalRead: z.string().describe("Two plain sentences: where the goal stands and what we're doing about it"),
  experimentReviews: z.array(
    z.object({
      id: z.string(),
      decision: z.enum(["keep", "revert", "extend"]),
      result: z.string(),
      insight: z.string().describe("Durable learning, or empty"),
    }),
  ),
  newExperiment: z
    .object({
      bottleneck: z.enum(BOTTLENECKS),
      lever: z.string(),
      finding: z.string(),
      change: z.string(),
      expected: z.string(),
      metric: z.string(),
      reviewInDays: z.number(),
    })
    .nullable(),
  microAdjustments: z.array(z.object({ lever: z.string(), change: z.string(), why: z.string() })),
  insights: z.array(z.object({ text: z.string(), confidence: z.enum(["low", "medium", "high"]), evidence: z.string() })),
  replan: z.object({ needed: z.boolean(), direction: z.string() }),
  weeklyReport: z.string().describe("Markdown report for the owner; empty unless requested"),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export interface AnalysisInput {
  ctx: ClientContext;
  playbooks: string;
  /** Pre-computed numbers: per-post table, experiment lifts, best hours, format stats. */
  data: string;
  mode: "daily" | "weekly";
  allowNewExperiment: boolean;
}

export async function analyze(llm: LLM, input: AnalysisInput): Promise<Analysis> {
  return llm.structured({
    task: `analyst.${input.mode}`,
    clientId: input.ctx.client.id,
    system: [
      { text: `${identity()}\n\n${ANALYST}\n\n<playbooks>\n${input.playbooks}\n</playbooks>`, cache: true },
      { text: renderClientBrief(input.ctx), cache: true },
    ],
    prompt: `${renderClientState(input.ctx)}\n\n<measured_data>\n${input.data}\n</measured_data>\n\nMode: ${input.mode}. ${
      input.allowNewExperiment ? "A new major experiment may be proposed." : "Do NOT propose a new major experiment (one is still running or one already started this week)."
    } ${input.mode === "weekly" ? "Write the weekly report." : "Leave weeklyReport empty."}`,
    schema: AnalysisSchema,
    effort: "high",
    maxTokens: 24000,
    demo: () => demoAnalysis(input),
  });
}

function demoAnalysis(input: AnalysisInput): Analysis {
  const b = input.ctx.diagnosis?.bottleneck ?? null;
  const levers: Record<string, { lever: string; change: string; expected: string; metric: string }> = {
    distribution: { lever: "posting time + Trial Reels", change: "Move reels to the two best learned hours and test hooks as Trial Reels first", expected: "+25% median reach per reel", metric: "reach" },
    hook: { lever: "cold open", change: "Open every reel on the payoff frame with 4-word on-screen text in the first second", expected: "3s retention from ~40% to 55%", metric: "retention3s" },
    resonance: { lever: "utility", change: "Shift two posts a week to teach-one-thing carousels with a save prompt", expected: "+40% saves per reach", metric: "saves" },
    conversion: { lever: "story follow-up", change: "Follow each reel with a 3-frame story ending in a link sticker", expected: "+30% profile visits", metric: "profile_visits" },
  };
  const exp = b && input.allowNewExperiment ? levers[b] : null;
  return {
    goalRead: input.ctx.goal
      ? `Goal "${input.ctx.goal.statement}" is ${input.ctx.goal.pace.replace("_", " ")}. ${b ? `The weakest link is ${b}, so this week's change targets it.` : "No single bottleneck stands out yet; keep the current mix and gather more posts."}`
      : "No goal is set yet. Set one so the agent can pace against it.",
    experimentReviews: input.ctx.experiments
      .filter((e) => e.reviewOn.getTime() <= input.ctx.now.getTime())
      .map((e) => ({ id: e.id, decision: "extend" as const, result: "Demo mode: not enough real data to decide.", insight: "" })),
    newExperiment: exp && b ? { bottleneck: b, finding: `Recent posts underperform on ${b}.`, reviewInDays: 7, ...exp } : null,
    microAdjustments: [{ lever: "CTA wording", change: "End captions with a question tied to the story instead of a generic CTA", why: "Questions invite comments, which feed distribution." }],
    insights: [],
    replan: { needed: Boolean(exp), direction: exp ? `Re-cut upcoming concepts around: ${exp.change}.` : "" },
    weeklyReport: input.mode === "weekly" ? `## Weekly report (demo)\n\n- Goal pace: ${input.ctx.goal?.pace ?? "no goal"}\n- Bottleneck: ${b ?? "none clear"}\n- Next week: ${exp?.change ?? "keep the mix, add more data"}` : "",
  };
}
