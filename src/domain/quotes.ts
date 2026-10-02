import { PLATFORM_API_COST_USD } from "./platform-specs";
import type { ProductionPlan } from "./schemas";
import type { Platform, Quote, QuoteItem } from "./types";
import { extractUrls } from "./captions";

/**
 * Price table used for quotes. Every number is an editable estimate (Settings → Pricing):
 * Higgsfield's API bills USD per request from a prepaid balance and prices vary by model,
 * resolution and duration, so set these to what your console shows.
 */
export interface PriceTable {
  models: Record<string, { label: string; usdPerSecond?: number; usdPerImage?: number }>;
  elevenlabs: { usdPer1kChars: number; musicUsdPerMinute: number; sfxUsdEach: number };
  claude: { usdPerScenarioPlan: number; usdPerProductionPlan: number };
  /** Applied on top of the sum to cover retries and variations. */
  contingencyPct: number;
}

export const DEFAULT_PRICES: PriceTable = {
  models: {
    "video.cinematic": { label: "Seedance (720p)", usdPerSecond: 0.12 },
    "video.fast": { label: "Fast video draft", usdPerSecond: 0.05 },
    "video.product": { label: "Product video", usdPerSecond: 0.15 },
    "image.hero": { label: "Photoreal still", usdPerImage: 0.06 },
    "image.fast": { label: "Fast still", usdPerImage: 0.02 },
  },
  elevenlabs: { usdPer1kChars: 0.2, musicUsdPerMinute: 0.6, sfxUsdEach: 0.08 },
  claude: { usdPerScenarioPlan: 0.45, usdPerProductionPlan: 0.12 },
  contingencyPct: 15,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function quoteForPlan(
  plan: ProductionPlan,
  prices: PriceTable,
  opts: { platforms: Platform[]; xCaption?: string; includePlanning?: boolean } = { platforms: [] },
): Quote {
  const items: QuoteItem[] = [];
  const modelPrice = (key: string) => prices.models[key] ?? prices.models[key.split(".")[0] === "video" ? "video.cinematic" : "image.hero"];

  for (const shot of plan.shots) {
    const p = modelPrice(shot.model);
    if (shot.kind === "video") {
      const seconds = Math.max(1, Math.ceil(shot.durationSec));
      items.push({ tool: "higgsfield", model: shot.model, units: seconds, unit: "sec", usd: round2(seconds * (p?.usdPerSecond ?? 0.12)), note: `Shot ${shot.id}` });
      if (shot.keyframePrompt) {
        const kp = modelPrice("image.hero");
        items.push({ tool: "higgsfield", model: "image.hero", units: 1, unit: "image", usd: round2(kp?.usdPerImage ?? 0.06), note: `Keyframe ${shot.id}` });
      }
    } else if (shot.kind === "still") {
      items.push({ tool: "higgsfield", model: shot.model, units: 1, unit: "image", usd: round2(p?.usdPerImage ?? 0.06), note: `Still ${shot.id}` });
    }
  }

  for (const [i, frame] of plan.frames.entries()) {
    const p = modelPrice(frame.model);
    items.push({ tool: "higgsfield", model: frame.model, units: 1, unit: "image", usd: round2(p?.usdPerImage ?? 0.06), note: `Frame ${i + 1}` });
  }

  if (plan.voiceover?.script) {
    const chars = [...plan.voiceover.script].length;
    items.push({ tool: "elevenlabs", model: "eleven_v3", units: chars, unit: "chars", usd: round2((chars / 1000) * prices.elevenlabs.usdPer1kChars), note: "Voiceover" });
  }
  if (plan.music) {
    const minutes = Math.max(0.25, plan.durationSec / 60);
    items.push({ tool: "elevenlabs", model: "music", units: round2(minutes), unit: "min", usd: round2(minutes * prices.elevenlabs.musicUsdPerMinute), note: "Music bed" });
  }
  if (plan.sfx.length) {
    items.push({ tool: "elevenlabs", model: "sfx", units: plan.sfx.length, unit: "sfx", usd: round2(plan.sfx.length * prices.elevenlabs.sfxUsdEach), note: "Sound design" });
  }

  if (opts.platforms.includes("x")) {
    const withLink = opts.xCaption ? extractUrls(opts.xCaption).length > 0 : false;
    items.push({
      tool: "x-api",
      model: withLink ? "post+link" : "post",
      units: 1,
      unit: "post",
      usd: withLink ? PLATFORM_API_COST_USD.x.postWithLink : PLATFORM_API_COST_USD.x.post,
      note: withLink ? "X charges $0.20 for posts with links" : "X API post",
    });
  }

  if (opts.includePlanning !== false) {
    items.push({ tool: "claude", model: "production-plan", units: 1, unit: "plan", usd: prices.claude.usdPerProductionPlan, note: "Direction + captions" });
  }

  const subtotal = items.reduce((a, i) => a + i.usd, 0);
  if (prices.contingencyPct > 0 && subtotal > 0) {
    items.push({ tool: "buffer", model: "contingency", units: prices.contingencyPct, unit: "%", usd: round2((subtotal * prices.contingencyPct) / 100), note: "Retries / variations" });
  }
  return { items, totalUsd: round2(items.reduce((a, i) => a + i.usd, 0)), currency: "USD", estimated: true };
}

/** The skill's rule: stop and re-quote when real cost would exceed the quote by more than 15%. */
export function exceedsQuote(actualUsd: number, quote: Quote | null | undefined, tolerancePct = 15): boolean {
  if (!quote) return false;
  return actualUsd > quote.totalUsd * (1 + tolerancePct / 100);
}
