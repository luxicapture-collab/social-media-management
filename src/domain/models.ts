/**
 * Generation model registry. The planner refers to models by *role key* (e.g. "video.cinematic");
 * the registry maps each role to a Higgsfield API endpoint and to how our parameters are written
 * into that endpoint's JSON body. Edit it in Settings → Models when Higgsfield adds models — each
 * model page in the Higgsfield console shows its endpoint path and input fields.
 */

export type FieldShape =
  | { kind: "string"; field: string }
  | { kind: "dop_images"; field: string } // [{ type: "image_url", image_url }]
  | { kind: "string_array"; field: string };

export interface ModelEntry {
  key: string;
  label: string;
  kind: "video" | "image";
  /** Higgsfield REST endpoint path, without the leading slash. */
  endpoint: string;
  /** Endpoint used when animating a still (image-to-video). Empty = text-to-video only. */
  i2vEndpoint?: string;
  /** True when the endpoint can only animate an input image. */
  requiresImage?: boolean;
  fields: {
    prompt: string;
    aspect?: string;
    duration?: string;
    image?: FieldShape;
    /** Soul-style models take WIDTHxHEIGHT instead of an aspect ratio. */
    size?: string;
  };
  /** Extra constant body fields (model variant, resolution, quality...). */
  defaults: Record<string, unknown>;
  /** Allowed durations; the nearest one is used. Empty = any integer up to maxDurationSec. */
  durations?: number[];
  maxDurationSec?: number;
  description: string;
  /** True when the endpoint and field names come from Higgsfield's official SDK/docs. */
  verified: boolean;
}

export const DEFAULT_MODELS: ModelEntry[] = [
  {
    key: "video.cinematic",
    label: "Seedance 2.0",
    kind: "video",
    endpoint: "bytedance/seedance-2.0/text-to-video",
    i2vEndpoint: "bytedance/seedance-2.0/image-to-video",
    fields: { prompt: "prompt", aspect: "aspect_ratio", duration: "duration", image: { kind: "string", field: "image_url" } },
    defaults: { resolution: "720p" },
    maxDurationSec: 12,
    description: "Photoreal cinematic motion with strong prompt adherence and identity consistency. Default for hero shots (text- or image-to-video).",
    verified: false,
  },
  {
    key: "video.fast",
    label: "DoP Turbo (image-to-video)",
    kind: "video",
    endpoint: "v1/image2video/dop",
    requiresImage: true,
    fields: { prompt: "prompt", image: { kind: "dop_images", field: "input_images" } },
    defaults: { model: "dop-turbo" },
    durations: [5],
    description: "Fast, cheap camera-move animation of a still keyframe. Good for B-roll and subtle motion.",
    verified: true,
  },
  {
    key: "image.hero",
    label: "FLUX Kontext Max",
    kind: "image",
    endpoint: "flux-pro/kontext/max/text-to-image",
    fields: { prompt: "prompt", aspect: "aspect_ratio" },
    defaults: { safety_tolerance: 2 },
    description: "High-fidelity photoreal stills and keyframes; follows detailed cinematography prompts.",
    verified: true,
  },
  {
    key: "image.fast",
    label: "Higgsfield Soul",
    kind: "image",
    endpoint: "v1/text2image/soul",
    fields: { prompt: "prompt", size: "width_and_height" },
    defaults: { quality: "1080p", batch_size: 1 },
    description: "Higgsfield's fashion/editorial photoreal still model. Cheaper option for carousels and story frames.",
    verified: true,
  },
];

/** Nearest Soul size for an aspect ratio. */
export function soulSize(aspect: string): string {
  switch (aspect) {
    case "9:16":
      return "1152x2048";
    case "16:9":
      return "2048x1152";
    case "1:1":
      return "1536x1536";
    case "4:5":
    case "3:4":
      return "1152x1536";
    default:
      return "1152x2048";
  }
}

export function describeModelsForPlanner(models: ModelEntry[]): string {
  return models
    .map((m) => `- ${m.key} (${m.kind}${m.requiresImage ? ", needs a keyframe" : ""}${m.maxDurationSec ? `, ≤${m.maxDurationSec}s per shot` : ""}${m.durations?.length ? `, durations ${m.durations.join("/")}s` : ""}): ${m.description}`)
    .join("\n");
}

export function resolveModel(models: ModelEntry[], key: string): ModelEntry | undefined {
  return models.find((m) => m.key === key) ?? models.find((m) => m.key.startsWith(key.split(".")[0] + "."));
}

export function nearestDuration(entry: ModelEntry, seconds: number): number {
  if (entry.durations?.length) {
    return entry.durations.reduce((best, d) => (Math.abs(d - seconds) < Math.abs(best - seconds) ? d : best), entry.durations[0]);
  }
  const max = entry.maxDurationSec ?? 10;
  return Math.max(3, Math.min(max, Math.ceil(seconds)));
}

/** Build the Higgsfield request body for a model entry. */
export function buildModelInput(
  entry: ModelEntry,
  input: { prompt: string; aspect?: string; durationSec?: number; imageUrl?: string },
): { endpoint: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = { ...entry.defaults, [entry.fields.prompt]: input.prompt };
  if (entry.fields.aspect && input.aspect) body[entry.fields.aspect] = input.aspect;
  if (entry.fields.size) body[entry.fields.size] = soulSize(input.aspect ?? "9:16");
  if (entry.kind === "video" && entry.fields.duration && input.durationSec) body[entry.fields.duration] = nearestDuration(entry, input.durationSec);
  let endpoint = entry.endpoint;
  if (input.imageUrl && entry.fields.image) {
    const shape = entry.fields.image;
    if (shape.kind === "dop_images") body[shape.field] = [{ type: "image_url", image_url: input.imageUrl }];
    else if (shape.kind === "string_array") body[shape.field] = [input.imageUrl];
    else body[shape.field] = input.imageUrl;
    if (entry.i2vEndpoint) endpoint = entry.i2vEndpoint;
  }
  return { endpoint, body };
}
