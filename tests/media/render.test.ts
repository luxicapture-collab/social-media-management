import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probe } from "@/server/media/ffmpeg";
import { imagesToPdf, jpegSize } from "@/server/media/pdf";
import { demoMusic, demoStill } from "@/server/media/placeholders";
import { extractFrame, planXfades, renderStill, renderVideo } from "@/server/media/render";
import { buildAss, buildStillAss, chunkWords, wordsFromAlignment, wordsFromScript } from "@/server/media/subtitles";

const out = path.resolve("data/test/render");

describe("subtitles", () => {
  it("groups character alignment into words", () => {
    const chars = "Hi there".split("");
    const words = wordsFromAlignment({ characters: chars, starts: chars.map((_, i) => i * 0.1), ends: chars.map((_, i) => i * 0.1 + 0.1) });
    expect(words.map((w) => w.text)).toEqual(["Hi", "there"]);
    expect(words[1].start).toBeCloseTo(0.3);
  });

  it("chunks words for captions", () => {
    const words = wordsFromScript("This moment only happens once. We kept it exactly the way it felt.", 0, 5);
    const chunks = chunkWords(words);
    expect(chunks[0].map((w) => w.text).join(" ")).toBe("This moment only");
    expect(chunks.every((c) => c.length <= 3)).toBe(true);
  });

  it("builds a valid ASS document with karaoke captions and RTL style", () => {
    const ass = buildAss({
      width: 1080,
      height: 1920,
      overlays: [{ text: "Watch the left side", startSec: 0, endSec: 2, role: "hook", position: "center" }],
      captions: wordsFromScript("Hello world again", 0, 2),
    });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("\\kf");
    const fa = buildAss({ width: 1080, height: 1920, overlays: [], captions: wordsFromScript("این لحظه فقط یک بار", 0, 2), language: "fa" });
    expect(fa).toContain("CaptionRtl");
    expect(fa).toContain("Vazirmatn");
  });
});

describe("xfade planning", () => {
  it("keeps plan timings aligned with the output timeline", () => {
    const plan = planXfades([
      { kind: "black", durationSec: 2 },
      { kind: "image", durationSec: 3, transitionIn: "dissolve" },
      { kind: "image", durationSec: 3, transitionIn: "cut" },
    ]);
    expect(plan.totalSeconds).toBe(8);
    expect(plan.offsets).toEqual([2, 5]);
    expect(plan.segmentSeconds[0]).toBeCloseTo(2.45);
  });
});

describe("renderer (ffmpeg)", () => {
  it("renders a 9:16 reel with overlays, captions and ducked music", async () => {
    await fs.mkdir(out, { recursive: true });
    const s1 = await demoStill("hands at work", 1080, 1920, path.join(out, "s1.jpg"));
    const s2 = await demoStill("wide location golden hour", 1080, 1920, path.join(out, "s2.jpg"));
    const music = await demoMusic(9, path.join(out, "music.mp3"));
    const ass = buildAss({
      width: 1080,
      height: 1920,
      titleCards: [{ text: "NOBODY SEES THIS PART", start: 0, end: 2 }],
      overlays: [
        { text: "Every frame, honest.", startSec: 3, endSec: 5.5, role: "point", position: "bottom" },
        { text: "Link in bio", startSec: 7, endSec: 9, role: "cta", position: "center" },
      ],
      captions: wordsFromScript("This moment only happens once. We kept it exactly the way it felt.", 2.2, 4.6),
    });
    const result = await renderVideo({
      width: 1080,
      height: 1920,
      clips: [
        { kind: "black", durationSec: 2 },
        { kind: "image", path: s1, durationSec: 3.5, motion: "push_in", transitionIn: "dissolve" },
        { kind: "image", path: s2, durationSec: 3.5, motion: "pan_right", transitionIn: "whip" },
      ],
      assContent: ass,
      music: { path: music },
      output: path.join(out, "reel.mp4"),
      workDir: path.join(out, "work"),
    });
    expect(result.durationSec).toBeGreaterThan(8.7);
    expect(result.durationSec).toBeLessThan(9.3);
    const info = await probe(result.output);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);
    expect(info.hasAudio).toBe(true);
    await extractFrame(result.output, 1.0, path.join(out, "frame-hook.jpg"));
    await extractFrame(result.output, 4.2, path.join(out, "frame-caption.jpg"));
    await extractFrame(result.output, 8.0, path.join(out, "frame-cta.jpg"));
  }, 240_000);

  it("renders carousel stills with typography and packs a PDF", async () => {
    const bg = await demoStill("carousel frame", 1080, 1350, path.join(out, "c-bg.jpg"));
    const frames: Buffer[] = [];
    for (let i = 0; i < 2; i++) {
      const f = await renderStill({
        imagePath: bg,
        width: 1080,
        height: 1350,
        assContent: buildStillAss({ width: 1080, height: 1350, title: i === 0 ? "The detail everyone misses" : "1 · Light first", body: i === 0 ? "A 60-year-old film, restored frame by frame" : "", index: i, total: 2 }),
        output: path.join(out, `carousel-${i}.jpg`),
        workDir: path.join(out, "work"),
      });
      frames.push(await fs.readFile(f));
    }
    expect(jpegSize(frames[0])).toEqual({ width: 1080, height: 1350 });
    const pdf = imagesToPdf(frames, "Test carousel");
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(pdf.toString("latin1")).toContain("/Count 2");
    await fs.writeFile(path.join(out, "carousel.pdf"), pdf);
  }, 120_000);
});
