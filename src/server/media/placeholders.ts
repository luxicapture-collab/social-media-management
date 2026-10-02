import { sha256Hex } from "../crypto";
import { ffmpeg } from "./ffmpeg";

/**
 * Demo-mode media: film-grain gradient stills and a soft synthesized pad, rendered locally with
 * ffmpeg so the production pipeline runs end-to-end without Higgsfield/ElevenLabs keys.
 */

const PALETTES: Array<[string, string]> = [
  ["0x1b120d", "0xc8873f"],
  ["0x0c1218", "0x6f8fa8"],
  ["0x160d12", "0xb06a5c"],
  ["0x0f1410", "0x8a9a6a"],
  ["0x120f18", "0x8e74b0"],
  ["0x181208", "0xe0b25a"],
];

export async function demoStill(prompt: string, width: number, height: number, output: string): Promise<string> {
  const h = sha256Hex(prompt);
  const [c0, c1] = PALETTES[parseInt(h.slice(0, 2), 16) % PALETTES.length];
  const angle = parseInt(h.slice(2, 4), 16) % 4;
  const [x0, y0, x1, y1] = [
    [0, 0, width, height],
    [width, 0, 0, height],
    [0, height, width, 0],
    [width / 2, 0, width / 2, height],
  ][angle];
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `gradients=s=${width}x${height}:c0=${c0}:c1=${c1}:x0=${Math.round(x0)}:y0=${Math.round(y0)}:x1=${Math.round(x1)}:y1=${Math.round(y1)}:nb_colors=2:d=1`,
    "-vf",
    "noise=alls=16:allf=t,vignette=PI/4",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    output,
  ]);
  return output;
}

/** A gentle three-note pad (A minor) with slow fades — placeholder for the ElevenLabs music bed. */
export async function demoMusic(seconds: number, output: string): Promise<string> {
  const d = Math.max(3, seconds).toFixed(2);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:duration=${d}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=261.63:duration=${d}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=329.63:duration=${d}`,
    "-filter_complex",
    `[0:a][1:a][2:a]amix=inputs=3:normalize=1,volume=0.5,tremolo=f=0.4:d=0.3,aecho=0.8:0.7:120:0.35,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, Number(d) - 1.5)}:d=1.5[a]`,
    "-map",
    "[a]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "160k",
    output,
  ]);
  return output;
}
