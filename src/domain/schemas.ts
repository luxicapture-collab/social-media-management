import { z } from "zod";
import { ANGLES, FORMATS, PLATFORMS } from "./types";

/**
 * Shared zod schemas: used to validate Claude's structured outputs and to type the JSON
 * stored on content rows. Keep them free of numeric/string-length constraints so they
 * compile to the JSON-schema subset structured outputs support.
 */

export const PlatformSchema = z.enum(PLATFORMS);
export const FormatSchema = z.enum(FORMATS);
export const AngleSchema = z.enum(ANGLES);
export const AspectSchema = z.enum(["9:16", "4:5", "1:1", "16:9"]);

export const ShotSchema = z.object({
  id: z.string().describe("Short id such as s1, s2"),
  kind: z.enum(["video", "still", "title"]).describe("video = generated motion clip; still = generated image with camera move; title = typographic card"),
  model: z.string().describe("Model role key from the model registry, e.g. video.cinematic or image.hero"),
  prompt: z.string().describe("Full generation prompt in the house cinematic grammar (subject, action, setting, lens, light, camera move, grade)"),
  keyframePrompt: z.string().describe("Prompt for a still keyframe to animate from (image-to-video) for consistency; empty string if text-to-video").default(""),
  durationSec: z.number().describe("Seconds this shot holds on screen"),
  camera: z.string().describe("Camera move / framing note").default(""),
  motion: z.enum(["push_in", "pull_out", "pan_left", "pan_right", "static"]).describe("Camera move applied to stills").default("push_in"),
  transitionIn: z.enum(["cut", "fade", "dissolve", "slide", "zoom", "whip"]).default("cut"),
});
export type Shot = z.infer<typeof ShotSchema>;

export const TextOverlaySchema = z.object({
  text: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  role: z.enum(["hook", "point", "cta", "caption"]),
  position: z.enum(["top", "center", "bottom"]).default("center"),
});
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

export const FrameSchema = z.object({
  prompt: z.string().describe("Image prompt for this carousel/story/post frame"),
  model: z.string().default("image.hero"),
  title: z.string().describe("Large on-image text; empty for none").default(""),
  body: z.string().describe("Small on-image text; empty for none").default(""),
  sticker: z.string().describe("Story sticker plan (poll/question/link/countdown) or empty").default(""),
});
export type Frame = z.infer<typeof FrameSchema>;

export const ProductionPlanSchema = z.object({
  aspect: AspectSchema,
  durationSec: z.number().describe("Total runtime for video formats; 0 for stills"),
  shots: z.array(ShotSchema).describe("Video shots in order; empty for still/carousel content"),
  frames: z.array(FrameSchema).describe("Still frames for carousel, image post or story; empty for pure video"),
  voiceover: z
    .object({
      script: z.string(),
      language: z.string().describe("ISO 639-1, e.g. en or fa"),
      voiceStyle: z.string().describe("Casting note: age, tone, pace"),
    })
    .nullable()
    .describe("Null when the piece has no narration"),
  music: z
    .object({ prompt: z.string(), instrumental: z.boolean() })
    .nullable()
    .describe("Music bed brief, null for silence/native audio"),
  sfx: z.array(z.object({ prompt: z.string(), atSec: z.number(), durationSec: z.number() })).default([]),
  textOverlays: z.array(TextOverlaySchema).default([]),
  burnCaptions: z.boolean().describe("Burn word-synced captions from the voiceover").default(true),
  coverAtSec: z.number().describe("Frame time to use as cover/thumbnail").default(0.5),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;

export const CaptionsSchema = z.object({
  instagram: z.string().default(""),
  facebook: z.string().default(""),
  linkedin: z.string().default(""),
  x: z.string().default(""),
});
export type Captions = z.infer<typeof CaptionsSchema>;

export const StoryFrameSchema = z.object({ text: z.string(), sticker: z.string().default("") });

export const ConceptSchema = z.object({
  title: z.string(),
  angle: AngleSchema,
  format: FormatSchema,
  platforms: z.array(PlatformSchema),
  hook: z.string().describe("The first 1-2 seconds: what is seen and the first words/on-screen line"),
  beats: z.array(z.string()).describe('Timed beats such as "0–2s: ..."'),
  rationale: z.string().describe("One or two sentences: why this hits the goal for this audience"),
  captions: CaptionsSchema,
  storyFrames: z.array(StoryFrameSchema).default([]),
  firstComments: z
    .object({ instagram: z.string().default(""), facebook: z.string().default(""), linkedin: z.string().default(""), x: z.string().default("") })
    .default({ instagram: "", facebook: "", linkedin: "", x: "" }),
  scheduledAt: z.string().describe("Proposed local date-time ISO 8601 with offset, or empty to let the scheduler pick").default(""),
  trialReel: z.boolean().describe("Instagram only: test a risky hook on non-followers first").default(false),
  experimentTag: z.string().describe("Id of the running experiment this concept tests, or empty").default(""),
  production: ProductionPlanSchema,
});
export type Concept = z.infer<typeof ConceptSchema>;
