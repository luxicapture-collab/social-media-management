import fs from "node:fs/promises";
import path from "node:path";
import { ffmpeg, filterPath, probe } from "./ffmpeg";

/**
 * The motion-video renderer: turns generated shots/stills, a voiceover, a music bed and an ASS
 * typography track into a finished, platform-ready MP4. Pure ffmpeg, no After Effects.
 */

export type Motion = "push_in" | "pull_out" | "pan_left" | "pan_right" | "static";
export type Transition = "cut" | "fade" | "dissolve" | "slide" | "zoom" | "whip";

export interface ClipInput {
  kind: "video" | "image" | "black";
  path?: string;
  durationSec: number;
  motion?: Motion;
  transitionIn?: Transition;
}

export interface VideoRenderSpec {
  width: number;
  height: number;
  fps?: number;
  clips: ClipInput[];
  assContent?: string;
  voiceover?: { path: string; startSec: number };
  music?: { path: string; gainDb?: number };
  sfx?: Array<{ path: string; atSec: number }>;
  output: string;
  workDir: string;
  loudnessLufs?: number;
  grain?: boolean;
}

export function fontsDir(): string {
  return path.join(process.cwd(), "assets", "fonts");
}

const TRANSITIONS: Record<Transition, { name: string; duration: number }> = {
  cut: { name: "fade", duration: 1 / 30 },
  dissolve: { name: "fade", duration: 0.45 },
  fade: { name: "fadeblack", duration: 0.5 },
  slide: { name: "slideleft", duration: 0.4 },
  zoom: { name: "zoomin", duration: 0.4 },
  whip: { name: "smoothleft", duration: 0.3 },
};

export function transitionFor(t: Transition | undefined) {
  return TRANSITIONS[t ?? "cut"];
}

function zoompanExpr(motion: Motion, frames: number): { z: string; x: string; y: string } {
  const n = Math.max(1, frames - 1);
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";
  switch (motion) {
    case "push_in":
      return { z: `1+0.12*on/${n}`, x: centerX, y: centerY };
    case "pull_out":
      return { z: `1.12-0.12*on/${n}`, x: centerX, y: centerY };
    case "pan_right":
      return { z: "1.12", x: `(iw-iw/zoom)*on/${n}`, y: centerY };
    case "pan_left":
      return { z: "1.12", x: `(iw-iw/zoom)*(1-on/${n})`, y: centerY };
    default:
      return { z: `1+0.03*on/${n}`, x: centerX, y: centerY };
  }
}

/** Normalise one clip into a silent H.264 segment of exactly `seconds` at W×H. */
export async function renderSegment(clip: ClipInput, seconds: number, W: number, H: number, fps: number, out: string): Promise<void> {
  const frames = Math.max(2, Math.round(seconds * fps));
  const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an"];
  if (clip.kind === "image" && clip.path) {
    const { z, x, y } = zoompanExpr(clip.motion ?? "push_in", frames);
    const vf = [
      `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`,
      `crop=${W * 2}:${H * 2}`,
      `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=${fps}`,
      "setsar=1",
      "format=yuv420p",
    ].join(",");
    await ffmpeg(["-i", clip.path, "-vf", vf, "-frames:v", String(frames), ...enc, out]);
  } else if (clip.kind === "video" && clip.path) {
    const vf = [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, `fps=${fps}`, "setsar=1", "format=yuv420p"].join(",");
    await ffmpeg(["-stream_loop", "-1", "-i", clip.path, "-t", seconds.toFixed(3), "-vf", vf, "-frames:v", String(frames), ...enc, out]);
  } else {
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0d0b0a:s=${W}x${H}:r=${fps}:d=${seconds.toFixed(3)}`,
      "-vf",
      "noise=alls=7:allf=t,vignette=PI/5,format=yuv420p",
      "-frames:v",
      String(frames),
      ...enc,
      out,
    ]);
  }
}

export interface XfadePlan {
  segmentSeconds: number[];
  offsets: number[];
  transitions: Array<{ name: string; duration: number }>;
  totalSeconds: number;
}

/**
 * Each segment is extended by the next transition's duration so shot timings in the plan stay
 * aligned with the output timeline (xfade overlaps consecutive segments).
 */
export function planXfades(clips: ClipInput[]): XfadePlan {
  const transitions = clips.map((c, i) => (i === 0 ? { name: "none", duration: 0 } : transitionFor(c.transitionIn)));
  const segmentSeconds = clips.map((c, i) => c.durationSec + (transitions[i + 1]?.duration ?? 0));
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 1; i < clips.length; i++) {
    acc += clips[i - 1].durationSec;
    offsets.push(Number(acc.toFixed(3)));
  }
  const totalSeconds = clips.reduce((a, c) => a + c.durationSec, 0);
  return { segmentSeconds, offsets, transitions, totalSeconds };
}

export async function renderVideo(spec: VideoRenderSpec): Promise<{ output: string; durationSec: number }> {
  const W = spec.width;
  const H = spec.height;
  const fps = spec.fps ?? 30;
  if (!spec.clips.length) throw new Error("renderVideo: no clips");
  await fs.mkdir(spec.workDir, { recursive: true });

  const plan = planXfades(spec.clips);
  const segPaths: string[] = [];
  for (const [i, clip] of spec.clips.entries()) {
    const p = path.join(spec.workDir, `seg-${String(i).padStart(2, "0")}.mp4`);
    await renderSegment(clip, plan.segmentSeconds[i], W, H, fps, p);
    segPaths.push(p);
  }

  const total = plan.totalSeconds;
  const args: string[] = [];
  segPaths.forEach((p) => args.push("-i", p));
  let inputIndex = segPaths.length;

  const filters: string[] = [];
  let last = "[0:v]";
  for (let i = 1; i < segPaths.length; i++) {
    const t = plan.transitions[i];
    const outLabel = `[x${i}]`;
    filters.push(`${last}[${i}:v]xfade=transition=${t.name}:duration=${t.duration.toFixed(3)}:offset=${plan.offsets[i - 1].toFixed(3)}${outLabel}`);
    last = outLabel;
  }

  const videoChain: string[] = [];
  if (spec.assContent) {
    const assPath = path.join(spec.workDir, "overlay.ass");
    await fs.writeFile(assPath, spec.assContent, "utf8");
    videoChain.push(`ass=${filterPath(assPath)}:fontsdir=${filterPath(fontsDir())}`);
  }
  if (spec.grain !== false) videoChain.push("noise=alls=4:allf=t");
  videoChain.push("format=yuv420p");
  filters.push(`${last}${videoChain.join(",")}[vout]`);

  // Audio graph.
  const audioLabels: string[] = [];
  let voLabel: string | null = null;
  if (spec.voiceover) {
    args.push("-i", spec.voiceover.path);
    const ms = Math.round(spec.voiceover.startSec * 1000);
    filters.push(`[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},apad=whole_dur=${total.toFixed(3)},asplit=2[vo][vosc]`);
    voLabel = "[vo]";
    inputIndex++;
  }
  if (spec.music) {
    args.push("-stream_loop", "-1", "-i", spec.music.path);
    const gain = spec.music.gainDb ?? (spec.voiceover ? -8 : -3);
    const fadeOut = Math.max(0, total - 1.6);
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},volume=${gain}dB,afade=t=in:d=0.8,afade=t=out:st=${fadeOut.toFixed(3)}:d=1.5[mus]`,
    );
    if (voLabel) {
      filters.push(`[mus][vosc]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=450[musd]`);
      audioLabels.push("[musd]");
    } else {
      audioLabels.push("[mus]");
    }
    inputIndex++;
  } else if (voLabel) {
    filters.push(`[vosc]anullsink`);
  }
  if (voLabel) audioLabels.push(voLabel);
  for (const [i, s] of (spec.sfx ?? []).entries()) {
    args.push("-i", s.path);
    const ms = Math.round(s.atSec * 1000);
    filters.push(`[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=-4dB[sfx${i}]`);
    audioLabels.push(`[sfx${i}]`);
    inputIndex++;
  }
  if (audioLabels.length) {
    const lufs = spec.loudnessLufs ?? -14;
    filters.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000,atrim=0:${total.toFixed(3)},apad=whole_dur=${total.toFixed(3)}[aout]`,
    );
  } else {
    args.push("-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
    filters.push(`[${inputIndex}:a]anull[aout]`);
    inputIndex++;
  }

  await fs.mkdir(path.dirname(spec.output), { recursive: true });
  await ffmpeg(
    [
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      "-t",
      total.toFixed(3),
      spec.output,
    ],
    20 * 60_000,
  );
  const info = await probe(spec.output);
  return { output: spec.output, durationSec: info.durationSec };
}

/** Cover-crop an image to W×H and burn its typography (carousel / story / post frames). */
export async function renderStill(input: { imagePath: string; width: number; height: number; assContent?: string; output: string; workDir: string }): Promise<string> {
  await fs.mkdir(input.workDir, { recursive: true });
  const chain = [`scale=${input.width}:${input.height}:force_original_aspect_ratio=increase`, `crop=${input.width}:${input.height}`, "setsar=1"];
  if (input.assContent) {
    const assPath = path.join(input.workDir, `${path.basename(input.output)}.ass`);
    await fs.writeFile(assPath, input.assContent, "utf8");
    chain.push(`ass=${filterPath(assPath)}:fontsdir=${filterPath(fontsDir())}`);
  }
  await fs.mkdir(path.dirname(input.output), { recursive: true });
  await ffmpeg(["-i", input.imagePath, "-vf", chain.join(","), "-frames:v", "1", "-q:v", "2", input.output]);
  return input.output;
}

export async function extractFrame(video: string, atSec: number, output: string): Promise<string> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await ffmpeg(["-ss", Math.max(0, atSec).toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "2", output]);
  return output;
}

/** Convert any image to baseline JPEG (for PDFs and platforms that reject PNG/WebP). */
export async function toJpeg(input: string, output: string): Promise<string> {
  await ffmpeg(["-i", input, "-frames:v", "1", "-q:v", "2", "-pix_fmt", "yuvj420p", output]);
  return output;
}

/** A light 720p H.264 proxy for reviewing on a phone. */
export async function makeReviewProxy(input: string, output: string): Promise<string> {
  await ffmpeg(["-i", input, "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", output]);
  return output;
}
