import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { buildModelInput, resolveModel, type ModelEntry } from "@/domain/models";
import { mediaSpec } from "@/domain/platform-specs";
import { exceedsQuote, quoteForPlan } from "@/domain/quotes";
import type { Frame, ProductionPlan, Shot } from "@/domain/schemas";
import { speakingSeconds } from "@/domain/text";
import { aspectToSize } from "@/domain/platform-specs";
import type { Platform } from "@/domain/types";
import { logRun, raiseAlert } from "../activity";
import { config } from "../config";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { assets, contentItems, generationTasks, type ContentRow, type GenerationTaskRow } from "../db/schema";
import { ElevenLabsClient, pickVoice, type Alignment } from "../generation/elevenlabs";
import { GenerationError, HiggsfieldClient, isTerminal } from "../generation/higgsfield";
import { getModels } from "../generation/models";
import { PermanentJobError } from "../jobs/queue";
import { errorMessage, log } from "../log";
import { imagesToPdf } from "../media/pdf";
import { demoMusic, demoStill } from "../media/placeholders";
import { extractFrame, renderStill, renderVideo, toJpeg, type ClipInput } from "../media/render";
import { downloadToFile, extensionFor, mimeForExt, storage } from "../media/storage";
import { buildAss, buildStillAss, wordsFromAlignment, wordsFromScript, type Word } from "../media/subtitles";
import { notify } from "../notify";
import { getPrices, getSetting } from "../settings";

type Provider = "higgsfield" | "elevenlabs" | "demo";

const VO_START = 0.5;

export interface Capabilities {
  higgsfield: boolean;
  elevenlabs: boolean;
  demo: boolean;
}

export function capabilities(): Capabilities {
  const c = config();
  return { higgsfield: Boolean(c.higgsfield.credentials), elevenlabs: Boolean(c.elevenlabs.apiKey), demo: c.demo };
}

function workDir(contentId: string): string {
  return path.join(config().dataDir, "work", contentId);
}

/** Expand a production plan into generation tasks (keyframes before the shots that animate them). */
export function planTasks(plan: ProductionPlan, models: ModelEntry[], caps: Capabilities): Array<{ key: string; kind: GenerationTaskRow["kind"]; provider: Provider; input: Record<string, unknown>; dependsOn?: string }> {
  const visual: Provider = caps.demo || !caps.higgsfield ? "demo" : "higgsfield";
  const audio: Provider = caps.demo || !caps.elevenlabs ? "demo" : "elevenlabs";
  const tasks: Array<{ key: string; kind: GenerationTaskRow["kind"]; provider: Provider; input: Record<string, unknown>; dependsOn?: string }> = [];
  for (const shot of plan.shots) {
    if (shot.kind === "title") continue;
    const entry = resolveModel(models, shot.model);
    if (shot.kind === "still") {
      tasks.push({ key: `shot:${shot.id}`, kind: "image", provider: visual, input: { prompt: shot.prompt, model: shot.model, aspect: plan.aspect } });
      continue;
    }
    const needsKeyframe = Boolean(shot.keyframePrompt) || Boolean(entry?.requiresImage);
    if (needsKeyframe) {
      tasks.push({ key: `kf:${shot.id}`, kind: "image", provider: visual, input: { prompt: shot.keyframePrompt || shot.prompt, model: "image.hero", aspect: plan.aspect } });
    }
    tasks.push({
      key: `shot:${shot.id}`,
      kind: "video",
      provider: visual,
      input: { prompt: shot.prompt, model: shot.model, aspect: plan.aspect, durationSec: shot.durationSec },
      dependsOn: needsKeyframe ? `kf:${shot.id}` : undefined,
    });
  }
  plan.frames.forEach((f, i) => tasks.push({ key: `frame:${i}`, kind: "image", provider: visual, input: { prompt: f.prompt, model: f.model, aspect: plan.aspect } }));
  if (plan.voiceover?.script) tasks.push({ key: "vo", kind: "tts", provider: audio, input: { ...plan.voiceover } });
  if (plan.music) tasks.push({ key: "music", kind: "music", provider: audio, input: { ...plan.music, durationSec: Math.max(6, plan.durationSec + 1) } });
  plan.sfx.forEach((s, i) => tasks.push({ key: `sfx:${i}`, kind: "sfx", provider: audio, input: { ...s } }));
  return tasks;
}

function estCost(task: { kind: string; input: Record<string, unknown> }, prices: Awaited<ReturnType<typeof getPrices>>): number {
  const model = String(task.input.model ?? "");
  const p = prices.models[model];
  if (task.kind === "video") return (p?.usdPerSecond ?? prices.models["video.cinematic"].usdPerSecond ?? 0.12) * Math.ceil(Number(task.input.durationSec ?? 5));
  if (task.kind === "image") return p?.usdPerImage ?? prices.models["image.hero"].usdPerImage ?? 0.06;
  if (task.kind === "tts") return ([...String(task.input.script ?? "")].length / 1000) * prices.elevenlabs.usdPer1kChars;
  if (task.kind === "music") return (Number(task.input.durationSec ?? 20) / 60) * prices.elevenlabs.musicUsdPerMinute;
  if (task.kind === "sfx") return prices.elevenlabs.sfxUsdEach;
  return 0;
}

/** green-lit → producing: create the task graph. */
export async function startProduction(payload: { contentId: string }): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, payload.contentId));
  if (!item) throw new PermanentJobError(`Content ${payload.contentId} not found`);
  if (item.status !== "greenlit") return { skipped: `status is ${item.status}` };
  if (!item.production) throw new PermanentJobError("Content has no production plan");
  const caps = capabilities();
  const needsVisual = item.production.shots.some((s) => s.kind !== "title") || item.production.frames.length > 0;
  const needsAudio = Boolean(item.production.voiceover?.script || item.production.music || item.production.sfx.length);
  const missing: string[] = [];
  if (!caps.demo && needsVisual && !caps.higgsfield) missing.push("HIGGSFIELD_CREDENTIALS");
  if (!caps.demo && needsAudio && !caps.elevenlabs) missing.push("ELEVENLABS_API_KEY");
  if (missing.length) {
    await db
      .update(contentItems)
      .set({ status: "failed", agentNote: `Can't produce: set ${missing.join(" and ")} in the environment, then retry.`, updatedAt: new Date() })
      .where(eq(contentItems.id, item.id));
    await raiseAlert({ kind: "system", source: "production", title: "Generation credentials missing", summary: `Production of "${item.title}" needs ${missing.join(" and ")}. Nothing was spent.`, importance: "high", url: `/content/${item.id}`, clientId: item.clientId, dedupeKey: `creds:${missing.join(",")}` });
    return { failed: "missing credentials" };
  }

  const models = await getModels();
  const prices = await getPrices();
  const planned = planTasks(item.production, models, caps);
  await db.delete(generationTasks).where(eq(generationTasks.contentId, item.id));
  for (const t of planned) {
    await db.insert(generationTasks).values({
      id: newId("gen"),
      contentId: item.id,
      clientId: item.clientId,
      provider: t.provider,
      kind: t.kind,
      key: t.key,
      input: t.input,
      dependsOn: t.dependsOn ?? null,
      estCostUsd: t.provider === "demo" ? 0 : estCost(t, prices),
    });
  }
  await db.update(contentItems).set({ status: "producing", actualCostUsd: 0, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
  await logRun({ kind: "produce", clientId: item.clientId, summary: `Started production of "${item.title}" (${planned.length} generation tasks).`, details: { contentId: item.id } });
  return { tasks: planned.length };
}

// ------------------------------------------------------------------ task execution

let hfClient: HiggsfieldClient | undefined;
let elClient: ElevenLabsClient | undefined;

function higgsfield(): HiggsfieldClient {
  if (!hfClient) hfClient = new HiggsfieldClient(config().higgsfield.credentials!, config().higgsfield.baseUrl);
  return hfClient;
}

function elevenlabs(): ElevenLabsClient {
  if (!elClient) elClient = new ElevenLabsClient(config().elevenlabs.apiKey!);
  return elClient;
}

async function saveAsset(item: Pick<ContentRow, "id" | "clientId">, input: { file: string; kind: "image" | "video" | "audio" | "pdf"; role: string; source: string; mime?: string; meta?: Record<string, unknown>; durationSec?: number }): Promise<{ id: string; url: string; key: string }> {
  const ext = path.extname(input.file).slice(1) || "bin";
  const id = newId("ast");
  const key = `clients/${item.clientId}/${item.id}/${input.role}-${id}.${ext}`;
  const mime = input.mime ?? mimeForExt(ext);
  const stored = await storage().putFile(key, input.file, mime);
  const db = await getDb();
  await db.insert(assets).values({
    id,
    clientId: item.clientId,
    contentId: item.id,
    kind: input.kind,
    role: input.role,
    storageKey: stored.key,
    url: stored.url,
    mime,
    bytes: stored.bytes,
    durationSec: input.durationSec ?? null,
    source: input.source,
    meta: input.meta ?? {},
  });
  return { id, url: stored.url, key: stored.key };
}

async function assetById(id: string) {
  const db = await getDb();
  const [a] = await db.select().from(assets).where(eq(assets.id, id));
  return a;
}

async function voiceIdFor(style: string, clientId: string): Promise<string> {
  const perClient = await getSetting<Record<string, string>>("voices", {});
  const preferred = perClient[clientId] ?? config().elevenlabs.defaultVoiceId;
  if (preferred) return preferred;
  const voices = await elevenlabs().voices();
  const v = pickVoice(voices, style);
  if (!v) throw new PermanentJobError("No ElevenLabs voices available on this account");
  return v.voiceId;
}

async function markTask(id: string, patch: Partial<GenerationTaskRow>): Promise<void> {
  const db = await getDb();
  await db.update(generationTasks).set({ ...patch, updatedAt: new Date() }).where(eq(generationTasks.id, id));
}

/** Run (ElevenLabs, demo) or submit/poll (Higgsfield) one task. */
async function processTask(item: ContentRow, task: GenerationTaskRow, all: GenerationTaskRow[], models: ModelEntry[]): Promise<void> {
  const dir = workDir(item.id);
  await fs.mkdir(dir, { recursive: true });
  const input = task.input as Record<string, unknown>;
  const aspect = String(input.aspect ?? item.production?.aspect ?? "9:16");
  const size = aspectToSize(aspect);

  if (task.provider === "demo") {
    if (task.kind === "image" || task.kind === "video") {
      const file = await demoStill(String(input.prompt ?? task.key), size.width, size.height, path.join(dir, `${task.key.replace(/:/g, "-")}.jpg`));
      const a = await saveAsset(item, { file, kind: "image", role: task.key.replace(/:/g, "-"), source: "demo", meta: { prompt: input.prompt } });
      await markTask(task.id, { status: "completed", assetId: a.id });
    } else if (task.kind === "music") {
      const file = await demoMusic(Number(input.durationSec ?? 20), path.join(dir, "music.mp3"));
      const a = await saveAsset(item, { file, kind: "audio", role: "music", source: "demo" });
      await markTask(task.id, { status: "completed", assetId: a.id });
    } else {
      // Demo mode has no TTS/SFX: captions fall back to script timing.
      await markTask(task.id, { status: "completed", assetId: null });
    }
    return;
  }

  if (task.provider === "elevenlabs") {
    try {
      if (task.kind === "tts") {
        const voiceId = await voiceIdFor(String(input.voiceStyle ?? "warm narrator"), item.clientId);
        const language = String(input.language ?? "en");
        const { audio, alignment } = await elevenlabs().tts({ voiceId, text: String(input.script), modelId: "eleven_v3", languageCode: language });
        const file = path.join(dir, "vo.mp3");
        await fs.writeFile(file, audio);
        const a = await saveAsset(item, { file, kind: "audio", role: "voiceover", source: "elevenlabs", mime: "audio/mpeg", meta: { alignment, voiceId } });
        await markTask(task.id, { status: "completed", assetId: a.id });
      } else if (task.kind === "music") {
        const audio = await elevenlabs().music({ prompt: String(input.prompt), lengthMs: Number(input.durationSec ?? 20) * 1000, instrumental: input.instrumental !== false });
        const file = path.join(dir, "music.mp3");
        await fs.writeFile(file, audio);
        const a = await saveAsset(item, { file, kind: "audio", role: "music", source: "elevenlabs", mime: "audio/mpeg" });
        await markTask(task.id, { status: "completed", assetId: a.id });
      } else {
        const audio = await elevenlabs().soundEffect({ text: String(input.prompt), durationSeconds: Number(input.durationSec ?? 2) });
        const file = path.join(dir, `${task.key.replace(/:/g, "-")}.mp3`);
        await fs.writeFile(file, audio);
        const a = await saveAsset(item, { file, kind: "audio", role: task.key.replace(/:/g, "-"), source: "elevenlabs", mime: "audio/mpeg" });
        await markTask(task.id, { status: "completed", assetId: a.id });
      }
    } catch (err) {
      await failOrRetry(task, err);
    }
    return;
  }

  // Higgsfield: submit, then poll on later ticks.
  if (task.status === "queued") {
    const entry = resolveModel(models, String(input.model ?? (task.kind === "video" ? "video.cinematic" : "image.hero")));
    if (!entry) throw new PermanentJobError(`No model registered for "${String(input.model)}"`);
    let imageUrl: string | undefined;
    if (task.dependsOn) {
      const dep = all.find((t) => t.key === task.dependsOn);
      const depAsset = dep?.assetId ? await assetById(dep.assetId) : undefined;
      imageUrl = (depAsset?.meta as { sourceUrl?: string } | undefined)?.sourceUrl ?? depAsset?.url;
    }
    const { endpoint, body } = buildModelInput(entry, { prompt: String(input.prompt), aspect, durationSec: Number(input.durationSec ?? 5), imageUrl });
    try {
      const r = await higgsfield().submit(endpoint, body);
      await markTask(task.id, { status: "submitted", externalId: r.requestId, attempts: task.attempts + 1 });
    } catch (err) {
      await failOrRetry(task, err);
    }
    return;
  }

  if (task.status === "submitted" && task.externalId) {
    try {
      const r = await higgsfield().status(task.externalId);
      if (!isTerminal(r.status)) return;
      if (r.status !== "completed") {
        await failOrRetry(task, new GenerationError(`Higgsfield ${r.status}`, r.status !== "nsfw"));
        return;
      }
      const url = task.kind === "video" ? (r.videoUrl ?? r.imageUrls[0]) : (r.imageUrls[0] ?? r.videoUrl);
      if (!url) throw new GenerationError("Higgsfield completed without a media URL", true);
      const dl = await downloadToFile(url, path.join(dir, `${task.key.replace(/:/g, "-")}.download`));
      const ext = extensionFor(dl.mime, task.kind === "video" ? "mp4" : "jpg");
      const file = path.join(dir, `${task.key.replace(/:/g, "-")}.${ext}`);
      await fs.rename(dl.path, file);
      const a = await saveAsset(item, { file, kind: task.kind === "video" ? "video" : "image", role: task.key.replace(/:/g, "-"), source: "higgsfield", meta: { sourceUrl: url, prompt: input.prompt, requestId: task.externalId } });
      await markTask(task.id, { status: "completed", assetId: a.id });
    } catch (err) {
      await failOrRetry(task, err);
    }
  }
}

async function failOrRetry(task: GenerationTaskRow, err: unknown): Promise<void> {
  const retryable = err instanceof GenerationError ? err.retryable : true;
  const attempts = task.attempts + 1;
  log.warn("generation.task_failed", { task: task.key, error: errorMessage(err), attempts });
  if (retryable && attempts < 3) {
    const input = { ...(task.input as Record<string, unknown>) };
    // NSFW false positives: steer toward editorial framing on retry.
    if (/nsfw/i.test(errorMessage(err)) && typeof input.prompt === "string") input.prompt = `${input.prompt}, tasteful editorial framing, fully clothed`;
    await markTask(task.id, { status: "queued", externalId: null, attempts, error: errorMessage(err), input });
  } else {
    await markTask(task.id, { status: "failed", attempts, error: errorMessage(err).slice(0, 1000) });
  }
}

/** Cron: move every producing item forward (submit ready tasks, poll renders, assemble finished sets). */
export async function advanceProduction(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const items = await db.select().from(contentItems).where(eq(contentItems.status, "producing"));
  const models = await getModels();
  const prices = await getPrices();
  let assembled = 0;
  for (const item of items) {
    try {
      let tasks = await db.select().from(generationTasks).where(eq(generationTasks.contentId, item.id));
      const failed = tasks.filter((t) => t.status === "failed");
      if (failed.length) {
        await db
          .update(contentItems)
          .set({ status: "failed", agentNote: `Generation failed: ${failed.map((f) => `${f.key} (${f.error ?? "error"})`).join("; ").slice(0, 900)}`, updatedAt: new Date() })
          .where(eq(contentItems.id, item.id));
        await raiseAlert({ kind: "publish", source: "production", title: `Production failed: ${item.title}`, summary: `${failed.length} generation task(s) failed after retries. Nothing further was spent.`, importance: "high", url: `/content/${item.id}`, clientId: item.clientId, dedupeKey: `prodfail:${item.id}` });
        continue;
      }

      // Credits guard: projected spend (every task once, plus conservative retry cost) vs quote + 15%.
      const live = tasks.filter((t) => t.status !== "canceled");
      const spent = live.filter((t) => t.status === "completed").reduce((a, t) => a + t.estCostUsd, 0);
      const projected = live.reduce((a, t) => a + t.estCostUsd * Math.max(1, t.attempts), 0);
      if (exceedsQuote(projected, item.quote)) {
        const requote = quoteForPlan(item.production!, prices, { platforms: item.platforms, xCaption: item.captions.x });
        requote.totalUsd = Math.max(requote.totalUsd, Math.round(projected * 1.1 * 100) / 100);
        await db.update(generationTasks).set({ status: "canceled" }).where(and(eq(generationTasks.contentId, item.id), eq(generationTasks.status, "queued")));
        await db
          .update(contentItems)
          .set({ status: "concept", quote: requote, actualCostUsd: spent, agentNote: `Paused: the real cost would pass the approved quote by more than 15%. Re-quoted at $${requote.totalUsd.toFixed(2)} — green-light again to finish.`, updatedAt: new Date() })
          .where(eq(contentItems.id, item.id));
        await notify({ title: `Re-quote needed: ${item.title}`, body: `Spend would exceed the approved quote. New quote $${requote.totalUsd.toFixed(2)}.`, url: "/approvals", importance: "high" });
        continue;
      }

      const done = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.key));
      for (const t of tasks) {
        if (t.status === "completed" || t.status === "canceled") continue;
        if (t.dependsOn && !done.has(t.dependsOn)) continue;
        await processTask(item, t, tasks, models);
      }
      tasks = await db.select().from(generationTasks).where(eq(generationTasks.contentId, item.id));
      const actual = tasks.filter((t) => t.status === "completed").reduce((a, t) => a + t.estCostUsd, 0);
      await db.update(contentItems).set({ actualCostUsd: Math.round(actual * 100) / 100, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
      if (tasks.every((t) => t.status === "completed" || t.status === "canceled")) {
        await assemble(item.id);
        assembled++;
      }
    } catch (err) {
      log.error("production.advance_failed", { contentId: item.id, error: errorMessage(err) });
      if (err instanceof PermanentJobError) {
        await db.update(contentItems).set({ status: "failed", agentNote: errorMessage(err), updatedAt: new Date() }).where(eq(contentItems.id, item.id));
      }
    }
  }
  return { producing: items.length, assembled };
}

// ------------------------------------------------------------------ assembly

async function localPathFor(assetId: string, dir: string): Promise<string> {
  const a = await assetById(assetId);
  if (!a) throw new Error(`Asset ${assetId} missing`);
  return storage().toLocalFile(a.storageKey, dir);
}

/** Which aspect each platform needs for this content's format. */
export function aspectsByPlatform(format: ContentRow["format"], platforms: Platform[], masterAspect: string): Map<string, Platform[]> {
  const map = new Map<string, Platform[]>();
  for (const p of platforms) {
    const a = format === "reel" || format === "story" ? mediaSpec(p, format).aspect : masterAspect;
    map.set(a, [...(map.get(a) ?? []), p]);
  }
  if (!map.size) map.set(masterAspect, []);
  return map;
}

function voWords(plan: ProductionPlan, alignment: Alignment | undefined, total: number): Word[] {
  if (!plan.voiceover?.script) return [];
  if (alignment?.characters?.length) {
    return wordsFromAlignment(alignment).map((w) => ({ ...w, start: w.start + VO_START, end: w.end + VO_START }));
  }
  const dur = Math.min(speakingSeconds(plan.voiceover.script, plan.voiceover.language), Math.max(1, total - VO_START - 0.3));
  return wordsFromScript(plan.voiceover.script, VO_START, dur);
}

export async function assemble(contentId: string): Promise<void> {
  const db = await getDb();
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, contentId));
  if (!item?.production) throw new PermanentJobError("Nothing to assemble");
  const plan = item.production;
  const tasks = await db.select().from(generationTasks).where(eq(generationTasks.contentId, item.id));
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const dir = workDir(item.id);
  await fs.mkdir(dir, { recursive: true });
  const media: ContentRow["media"] = [];
  const started = new Date();

  const hasVideo = plan.shots.length > 0;
  if (hasVideo) {
    const voTask = byKey.get("vo");
    const voAsset = voTask?.assetId ? await assetById(voTask.assetId) : undefined;
    const alignment = (voAsset?.meta as { alignment?: Alignment } | undefined)?.alignment;
    const musicTask = byKey.get("music");
    const sfxTasks = plan.sfx.map((_, i) => byKey.get(`sfx:${i}`));
    const total = plan.shots.reduce((a, s) => a + s.durationSec, 0);

    const clips: ClipInput[] = [];
    const titleCards: Array<{ text: string; start: number; end: number }> = [];
    let t = 0;
    for (const shot of plan.shots as Shot[]) {
      if (shot.kind === "title") {
        clips.push({ kind: "black", durationSec: shot.durationSec, transitionIn: shot.transitionIn });
        titleCards.push({ text: shot.prompt, start: t, end: t + shot.durationSec });
      } else {
        const task = byKey.get(`shot:${shot.id}`);
        if (!task?.assetId) throw new PermanentJobError(`Shot ${shot.id} has no rendered media`);
        const a = await assetById(task.assetId);
        clips.push({ kind: a?.kind === "video" ? "video" : "image", path: await localPathFor(task.assetId, dir), durationSec: shot.durationSec, motion: shot.motion, transitionIn: shot.transitionIn });
      }
      t += shot.durationSec;
    }
    const words = plan.burnCaptions ? voWords(plan, alignment, total) : [];
    const voPath = voAsset ? await storage().toLocalFile(voAsset.storageKey, dir) : undefined;
    const musicPath = musicTask?.assetId ? await localPathFor(musicTask.assetId, dir) : undefined;
    const sfx: Array<{ path: string; atSec: number }> = [];
    for (const [i, s] of plan.sfx.entries()) {
      const st = sfxTasks[i];
      if (st?.assetId) sfx.push({ path: await localPathFor(st.assetId, dir), atSec: s.atSec });
    }

    for (const [aspect, platforms] of aspectsByPlatform(item.format, item.platforms, plan.aspect)) {
      const size = aspectToSize(aspect);
      const ass = buildAss({ width: size.width, height: size.height, overlays: plan.textOverlays, captions: words, titleCards, language: item.language });
      const out = path.join(dir, `final-${aspect.replace(":", "x")}.mp4`);
      const r = await renderVideo({
        width: size.width,
        height: size.height,
        clips,
        assContent: ass,
        voiceover: voPath ? { path: voPath, startSec: VO_START } : undefined,
        music: musicPath ? { path: musicPath } : undefined,
        sfx,
        output: out,
        workDir: path.join(dir, `render-${aspect.replace(":", "x")}`),
      });
      const cover = await extractFrame(out, Math.min(plan.coverAtSec || 0.5, r.durationSec - 0.1), path.join(dir, `cover-${aspect.replace(":", "x")}.jpg`));
      const video = await saveAsset(item, { file: out, kind: "video", role: `final-${aspect.replace(":", "x")}`, source: "ffmpeg", mime: "video/mp4", durationSec: r.durationSec });
      const coverAsset = await saveAsset(item, { file: cover, kind: "image", role: `cover-${aspect.replace(":", "x")}`, source: "ffmpeg", mime: "image/jpeg" });
      if (platforms.length) for (const p of platforms) media.push({ kind: "video", assetId: video.id, url: video.url, aspect, platform: p, coverUrl: coverAsset.url, role: "final" });
      else media.push({ kind: "video", assetId: video.id, url: video.url, aspect, coverUrl: coverAsset.url, role: "final" });
    }
  } else {
    const frames = plan.frames as Frame[];
    const size = aspectToSize(plan.aspect);
    const jpegs: Buffer[] = [];
    for (const [i, f] of frames.entries()) {
      const task = byKey.get(`frame:${i}`);
      if (!task?.assetId) throw new PermanentJobError(`Frame ${i + 1} has no image`);
      const src = await localPathFor(task.assetId, dir);
      const jpgSrc = path.extname(src).toLowerCase() === ".jpg" ? src : await toJpeg(src, path.join(dir, `frame-src-${i}.jpg`));
      const out = await renderStill({
        imagePath: jpgSrc,
        width: size.width,
        height: size.height,
        assContent: buildStillAss({ width: size.width, height: size.height, title: f.title, body: f.body, language: item.language, index: i, total: item.format === "carousel" ? frames.length : undefined }),
        output: path.join(dir, `final-frame-${i}.jpg`),
        workDir: dir,
      });
      jpegs.push(await fs.readFile(out));
      const a = await saveAsset(item, { file: out, kind: "image", role: `final-frame-${i}`, source: "ffmpeg", mime: "image/jpeg" });
      media.push({ kind: "image", assetId: a.id, url: a.url, aspect: plan.aspect, role: "final" });
    }
    if (item.format === "carousel" && item.platforms.includes("linkedin") && jpegs.length) {
      const pdfPath = path.join(dir, "carousel.pdf");
      await fs.writeFile(pdfPath, imagesToPdf(jpegs, item.title));
      const pdf = await saveAsset(item, { file: pdfPath, kind: "pdf", role: "document", source: "ffmpeg", mime: "application/pdf" });
      media.push({ kind: "pdf", assetId: pdf.id, url: pdf.url, platform: "linkedin", role: "document" });
    }
  }

  await db.update(contentItems).set({ status: "review", media, revisionNote: null, revisionOf: null, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await logRun({ kind: "produce", clientId: item.clientId, summary: `Cut ready for review: "${item.title}" (${media.length} deliverables, $${item.actualCostUsd.toFixed(2)} spent).`, details: { contentId: item.id }, startedAt: started });
  await notify({ title: `Ready for review: ${item.title}`, body: "Watch the cut, then approve to schedule or send notes.", url: `/content/${item.id}`, importance: "medium", tag: `review:${item.id}` });
}

/** For assets the UI shows (review proxies etc.). */
export async function contentAssets(contentId: string) {
  const db = await getDb();
  return db.select().from(assets).where(and(eq(assets.contentId, contentId), inArray(assets.kind, ["video", "image", "pdf"])));
}
