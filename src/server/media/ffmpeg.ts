import { spawn } from "node:child_process";
import { config } from "../config";

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FfmpegError(`${bin} timed out after ${timeoutMs}ms`, stderr));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new FfmpegError(`${bin} failed to start: ${err.message}. Is ffmpeg installed and on PATH (or FFMPEG_PATH set)?`, ""));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new FfmpegError(`${bin} exited with code ${code}: ${stderr.split("\n").filter(Boolean).slice(-6).join(" | ")}`, stderr));
    });
  });
}

export function ffmpeg(args: string[], timeoutMs = 10 * 60_000): Promise<{ stdout: string; stderr: string }> {
  return run(config().ffmpeg.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], timeoutMs);
}

export interface ProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(
    config().ffmpeg.ffprobe,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file],
    60_000,
  );
  const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; width?: number; height?: number }> };
  const video = data.streams?.find((s) => s.codec_type === "video");
  return {
    durationSec: Number(data.format?.duration ?? 0),
    width: video?.width,
    height: video?.height,
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
    hasVideo: Boolean(video),
  };
}

/** Escape a path for use inside an ffmpeg filter argument (e.g. ass=...). */
export function filterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
