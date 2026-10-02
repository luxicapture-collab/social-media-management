import { supportsFormat } from "@/domain/platform-specs";
import type { Captions, Concept, Frame, ProductionPlan, Shot } from "@/domain/schemas";
import type { Angle, Format, Platform } from "@/domain/types";
import { PLATFORMS } from "@/domain/types";
import type { PlanInput, PlanOutput, ReviewOutput } from "./strategist";

/**
 * Demo-mode stand-ins for Claude. They are deterministic and schema-valid so the full
 * pipeline (planning → production → approval → publishing → analytics) can be exercised
 * without an API key. Real runs use Claude for all of these.
 */

function topicOf(text: string): string {
  const first = text.split(/[.!?\n]/)[0]?.trim() ?? text;
  return first.length > 70 ? `${first.slice(0, 67).trim()}…` : first || "the story";
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

const ANGLE_IDEAS: Array<{ angle: Angle; idea: (t: string) => string; why: string; scores: [number, number, number, number] }> = [
  { angle: "transformation", idea: (t) => `Raw → finished: show ${t} changing in one continuous reveal`, why: "Visible change is the most reliably shared pattern for reach.", scores: [9, 7, 7, 9] },
  { angle: "behind_the_scenes", idea: (t) => `The hour nobody sees behind ${t}`, why: "Process content builds trust and follows with warm audiences.", scores: [8, 8, 8, 8] },
  { angle: "teach_one_thing", idea: (t) => `One thing people get wrong about ${t}`, why: "Utility drives saves; carousels carry it best.", scores: [8, 6, 9, 8] },
  { angle: "pov_story", idea: (t) => `POV: the moment ${t} hits someone for the first time`, why: "First-person emotion earns shares and comments.", scores: [8, 8, 6, 9] },
  { angle: "myth_vs_reality", idea: (t) => `Everyone assumes ${t} is easy. Reality:`, why: "Contrast provokes comments and debate.", scores: [7, 7, 8, 7] },
  { angle: "surreal_hook", idea: (t) => `One impossible-but-photoreal frame that stops the scroll around ${t}`, why: "Stopping power for cold audiences; costly, so one per week.", scores: [7, 9, 4, 8] },
];

function captionsFor(title: string, hook: string, topic: string, platforms: Platform[], format: Format, cta: string, tags: string[]): Captions {
  const ig = `${hook}\n\nWe filmed ${topic.toLowerCase()} the way it actually felt — no filters on the moment, only on the light.\n\n${cta}\n\n${tags.slice(0, 4).join(" ")}`;
  const fb = `${hook} Here's the story behind "${title}": ${topic}. We kept every frame honest and let the light do the work. ${cta}`;
  const li = `${topic}: the detail that changed the outcome wasn't the camera. It was the decision we made in the first ten minutes.\n\nWhat we did differently:\n→ Planned the light before the shot list\n→ Cut the story around one emotion\n→ Let the client's own words carry it\n\nWhich decision do you make first on a project like this?`;
  const x = `${hook} ${topic.length < 120 ? `(${topic.toLowerCase()})` : ""}`.trim().slice(0, 270);
  return {
    instagram: platforms.includes("instagram") && format !== "story" ? ig : "",
    facebook: platforms.includes("facebook") && format !== "story" ? fb : "",
    linkedin: platforms.includes("linkedin") ? li : "",
    x: platforms.includes("x") ? x : "",
  };
}

function videoPlan(topic: string, hook: string, language: string): ProductionPlan {
  const look = "anamorphic 40mm, motivated warm practical light, shallow depth of field, Kodak Vision3 500T grain, gentle halation, photoreal";
  const shots: Shot[] = [
    { id: "s1", kind: "title", model: "image.fast", prompt: hook, keyframePrompt: "", durationSec: 2.2, camera: "", motion: "static", transitionIn: "cut" },
    { id: "s2", kind: "still", model: "image.fast", prompt: `Close-up of hands at work on ${topic}, ${look}, slow push-in`, keyframePrompt: "", durationSec: 3, camera: "slow push-in", motion: "push_in", transitionIn: "dissolve" },
    { id: "s3", kind: "still", model: "image.fast", prompt: `Wide establishing frame of the location for ${topic} at golden hour, ${look}`, keyframePrompt: "", durationSec: 3, camera: "pan right", motion: "pan_right", transitionIn: "fade" },
    { id: "s4", kind: "still", model: "image.fast", prompt: `The emotional payoff: a face reacting to ${topic}, tear catching window light, ${look}`, keyframePrompt: "", durationSec: 3.5, camera: "pull out", motion: "pull_out", transitionIn: "dissolve" },
    { id: "s5", kind: "title", model: "image.fast", prompt: "Book your story — link in bio", keyframePrompt: "", durationSec: 2.3, camera: "", motion: "static", transitionIn: "fade" },
  ];
  const durationSec = shots.reduce((a, s) => a + s.durationSec, 0);
  return {
    aspect: "9:16",
    durationSec,
    shots,
    frames: [],
    voiceover: {
      script: language === "fa" ? "این لحظه فقط یک بار اتفاق می‌افتد. ما آن را همان‌طور که بود نگه داشتیم." : "This moment only happens once. We kept it exactly the way it felt.",
      language,
      voiceStyle: "warm, intimate, unhurried",
    },
    music: { prompt: "intimate solo piano, sparse, rising strings at the payoff, 80 bpm", instrumental: true },
    sfx: [],
    textOverlays: [
      { text: hook, startSec: 0, endSec: 2.2, role: "hook", position: "center" },
      { text: "Every frame, honest.", startSec: 5.5, endSec: 8, role: "point", position: "bottom" },
      { text: "Link in bio", startSec: durationSec - 2, endSec: durationSec, role: "cta", position: "center" },
    ],
    burnCaptions: true,
    coverAtSec: 6,
  };
}

function framesPlan(topic: string, count: number, format: Format): ProductionPlan {
  const titles = ["The detail everyone misses", "1 · Light first", "2 · One emotion", "3 · Real words", "4 · The cut", "Save this for your next shoot"];
  const frames: Frame[] = Array.from({ length: count }, (_, i) => ({
    prompt: `Editorial photoreal still about ${topic}, frame ${i + 1}, anamorphic, warm practical light, Kodak Vision3 500T grain`,
    model: "image.fast",
    title: format === "story" ? ["Guess the year?", "Behind the frame", "Want the full film?"][i % 3] : titles[i % titles.length],
    body: format === "story" ? "" : i === 0 ? topic : "",
    sticker: format === "story" ? ["poll: 1960s / 1980s", "question: what would you film?", "link: booking page"][i % 3] : "",
  }));
  return { aspect: format === "story" ? "9:16" : "4:5", durationSec: 0, shots: [], frames, voiceover: null, music: null, sfx: [], textOverlays: [], burnCaptions: false, coverAtSec: 0 };
}

export function demoPlan(input: PlanInput): PlanOutput {
  const s = input.scenario;
  const topic = topicOf(s.text);
  const formats: Format[] = s.formats.length ? s.formats : ["reel", "carousel", "story"];
  const allowed: Platform[] = s.platforms.length ? s.platforms : input.ctx.connected.length ? input.ctx.connected : [...PLATFORMS];
  const count = s.count ?? 3;
  const language = s.language || input.ctx.client.languages[0] || "en";
  const cta = input.ctx.client.brief.ctas[0] ?? "Send us a DM to plan yours.";
  const tags = input.ctx.client.brief.hashtags.length ? input.ctx.client.brief.hashtags : ["#cinematicfilm", "#behindthescenes", "#storytelling", "#filmmaking"];
  const experiment = input.ctx.experiments.find((e) => e.status === "running");

  const angles = ANGLE_IDEAS.map((a) => ({
    angle: a.angle,
    idea: a.idea(topic.toLowerCase()),
    goalFit: a.scores[0],
    novelty: a.scores[1],
    cost: a.scores[2],
    platformFit: a.scores[3],
    why: a.why,
  }));
  const ranked = [...angles].sort((a, b) => b.goalFit + b.novelty + b.cost + b.platformFit - (a.goalFit + a.novelty + a.cost + a.platformFit));

  const concepts: Concept[] = Array.from({ length: count }, (_, i) => {
    const format = formats[i % formats.length];
    const angle = ranked[i % ranked.length];
    const platforms = allowed.filter((p) => supportsFormat(p, format));
    const hook =
      format === "story"
        ? "Guess the year this was filmed"
        : angle.angle === "transformation"
          ? "Watch the left side of the frame."
          : angle.angle === "teach_one_thing"
            ? "The detail everyone misses:"
            : "Nobody sees this part.";
    const title = titleCase(`${angle.angle.replace(/_/g, " ")}: ${topic}`).slice(0, 80);
    const production = format === "reel" ? videoPlan(topic, hook, language) : framesPlan(topic, format === "carousel" ? 6 : format === "story" ? 3 : 1, format);
    return {
      title,
      angle: angle.angle,
      format,
      platforms,
      hook,
      beats:
        format === "reel"
          ? ["0–2s: hook card on black, hard cut in", "2–5s: hands at work, push-in", "5–8s: wide location, pan", "8–12s: emotional payoff", "12–14s: CTA card"]
          : production.frames.map((f, idx) => `Frame ${idx + 1}: ${f.title || "image"}`),
      rationale: `${angle.why} Built for the goal${input.ctx.goal ? ` (${input.ctx.goal.statement})` : ""}${input.ctx.diagnosis?.bottleneck ? ` and aimed at the ${input.ctx.diagnosis.bottleneck} bottleneck` : ""}.`,
      captions: captionsFor(title, hook, topic, platforms, format, cta, tags),
      storyFrames: format === "story" ? production.frames.map((f) => ({ text: f.title, sticker: f.sticker })) : [],
      firstComments: { instagram: "", facebook: "", linkedin: platforms.includes("linkedin") ? `Full story: ${input.ctx.client.website ?? "link in our profile"}` : "", x: "" },
      scheduledAt: "",
      trialReel: format === "reel" && angle.angle === "surreal_hook",
      experimentTag: i === 0 && experiment ? experiment.id : "",
      production,
    };
  });

  return {
    angles,
    concepts,
    planNote: `Demo mode: these concepts were generated from templates, not by Claude. Add ANTHROPIC_API_KEY for real planning. Considered ${angles.length} angles; kept ${concepts.length}.`,
  };
}

export function demoReview(concepts: Concept[]): ReviewOutput {
  return {
    reviews: concepts.map((c) => ({
      title: c.title,
      score: 7,
      notes: ["Demo review: hook is clear; in real runs the creative director rewrites anything below 8."],
    })),
    concepts,
  };
}

export function demoCaptionsFix(c: Captions): Captions {
  const fix = (t: string, maxTags: number) => {
    let n = 0;
    return t
      .replace(/#[\p{L}\p{N}_]+/gu, (m) => (++n <= maxTags ? m : ""))
      .replace(/\s{2,}/g, " ")
      .trim();
  };
  return { instagram: fix(c.instagram, 5), facebook: fix(c.facebook, 2), linkedin: fix(c.linkedin, 3), x: fix(c.x, 1).slice(0, 270) };
}
