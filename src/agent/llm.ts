import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "@/server/config";
import { newId } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { llmUsage } from "@/server/db/schema";
import { log } from "@/server/log";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface SystemPart {
  text: string;
  /** Mark stable prefixes (role prompt, playbooks, client brief) for prompt caching. */
  cache?: boolean;
}

export interface StructuredRequest<T> {
  /** Telemetry label, e.g. "strategist.plan". */
  task: string;
  clientId?: string | null;
  system: SystemPart[];
  prompt: string;
  schema: z.ZodType<T>;
  effort?: Effort;
  maxTokens?: number;
  /** Deterministic stand-in used in demo mode (no API key). Must satisfy `schema`. */
  demo: () => T;
}

export interface LLM {
  readonly mode: "claude" | "demo";
  structured<T>(req: StructuredRequest<T>): Promise<T>;
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`Claude declined this request${category ? ` (${category})` : ""}`);
    this.name = "LlmRefusalError";
  }
}

/** $/MTok — used only to log spend. Cache writes bill at 1.25× input. */
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

export function costUsd(
  model: string,
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
): number {
  const p = PRICING[model] ?? PRICING["claude-opus-5-5"];
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  return (u.input_tokens * p.input + u.output_tokens * p.output + read * p.cacheRead + write * p.input * 1.25) / 1_000_000;
}

/** Models that accept adaptive thinking + effort and the server-side refusal fallback. */
function modelCaps(model: string) {
  const modern = /claude-(opus-5|opus-4-[678]|sonnet-5|fable|mythos)/.test(model);
  const fallback = /claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)/.test(model);
  return { modern, fallback };
}

export async function recordUsage(task: string, model: string, clientId: string | null | undefined, usage: Anthropic.Beta.BetaUsage | Anthropic.Usage): Promise<number> {
  const cost = costUsd(model, usage);
  try {
    const db = await getDb();
    await db.insert(llmUsage).values({
      id: newId("llm"),
      task,
      model,
      clientId: clientId ?? null,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd: cost,
    });
  } catch (err) {
    log.warn("llm.usage_record_failed", { error: String(err) });
  }
  return cost;
}

let sharedClient: Anthropic | undefined;

export function anthropicClient(): Anthropic {
  if (!sharedClient) sharedClient = new Anthropic({ apiKey: config().claude.apiKey, maxRetries: 3 });
  return sharedClient;
}

/** Request fields shared by structured calls and the chat agent. */
export function modelRequestBase(effort: Effort) {
  const { model, fallbacks } = config().claude;
  const caps = modelCaps(model);
  return {
    model,
    ...(caps.modern ? { thinking: { type: "adaptive" as const }, output_config: { effort } } : {}),
    // Server-side refusal fallback: a declined request is retried on Anthropic's recommended model.
    ...(caps.fallback && fallbacks === "default" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

export class ClaudeLLM implements LLM {
  readonly mode = "claude" as const;

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const client = anthropicClient();
    const base = modelRequestBase(req.effort ?? "medium");
    const { output_config, ...rest } = base as typeof base & { output_config?: { effort: Effort } };
    const stream = client.beta.messages.stream({
      ...rest,
      max_tokens: req.maxTokens ?? 32000,
      system: req.system.map((p) => ({
        type: "text" as const,
        text: p.text,
        ...(p.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
      })),
      messages: [{ role: "user", content: req.prompt }],
      output_config: { ...(output_config ?? {}), format: betaZodOutputFormat(req.schema) },
    });
    const message = await stream.finalMessage();
    const cost = await recordUsage(req.task, message.model ?? base.model, req.clientId, message.usage);
    log.info("llm.call", {
      task: req.task,
      model: message.model,
      stop: message.stop_reason,
      in: message.usage.input_tokens,
      out: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      usd: Number(cost.toFixed(4)),
    });
    if (message.stop_reason === "refusal") {
      throw new LlmRefusalError(message.stop_details?.category ?? null);
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error(`${req.task}: output hit max_tokens (${req.maxTokens ?? 32000}); raise the limit or narrow the request`);
    }
    if (message.parsed_output == null) {
      throw new Error(`${req.task}: Claude returned no parsable structured output`);
    }
    return message.parsed_output as T;
  }
}

/** Demo mode: deterministic, schema-valid outputs so the whole pipeline runs without an API key. */
export class DemoLLM implements LLM {
  readonly mode = "demo" as const;

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const out = req.demo();
    return req.schema.parse(out);
  }
}

let llmOverride: LLM | undefined;

export function getLLM(): LLM {
  if (llmOverride) return llmOverride;
  return config().demo || !config().claude.apiKey ? new DemoLLM() : new ClaudeLLM();
}

/** Tests: inject a fake LLM. */
export function setLLMForTests(llm: LLM | undefined): void {
  llmOverride = llm;
}
