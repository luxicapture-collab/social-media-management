import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AwsClient } from "aws4fetch";
import { config } from "../config";

/**
 * Media storage. Platforms (Instagram in particular) fetch media from a public HTTPS URL, so
 * production deployments need either APP_URL to be publicly reachable (local driver serves
 * files at /api/media/...) or an S3-compatible bucket with public reads (R2, S3, Supabase).
 */

export interface StoredObject {
  key: string;
  url: string;
  bytes: number;
  mime: string;
}

export interface Storage {
  readonly driver: "local" | "s3";
  put(key: string, data: Buffer, mime: string): Promise<StoredObject>;
  putFile(key: string, filePath: string, mime: string): Promise<StoredObject>;
  read(key: string): Promise<Buffer>;
  /** A local filesystem path for the object, downloading it to `tmpDir` if needed. */
  toLocalFile(key: string, tmpDir: string): Promise<string>;
  publicUrl(key: string): string;
}

export function safeKey(key: string): string {
  const normalised = path.posix.normalize(key.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (normalised.startsWith("..") || normalised.includes("/../")) throw new Error(`Unsafe storage key: ${key}`);
  return normalised;
}

class LocalStorage implements Storage {
  readonly driver = "local" as const;
  constructor(private readonly root: string) {}

  private file(key: string) {
    return path.join(this.root, safeKey(key));
  }

  publicUrl(key: string): string {
    return `${config().appUrl}/api/media/${safeKey(key)}`;
  }

  async put(key: string, data: Buffer, mime: string): Promise<StoredObject> {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
    return { key: safeKey(key), url: this.publicUrl(key), bytes: data.length, mime };
  }

  async putFile(key: string, filePath: string, mime: string): Promise<StoredObject> {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.copyFile(filePath, f);
    const stat = await fs.stat(f);
    return { key: safeKey(key), url: this.publicUrl(key), bytes: stat.size, mime };
  }

  read(key: string): Promise<Buffer> {
    return fs.readFile(this.file(key));
  }

  async toLocalFile(key: string): Promise<string> {
    return this.file(key);
  }

  localPath(key: string): string {
    return this.file(key);
  }
}

class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private readonly aws: AwsClient;
  constructor(
    private readonly cfg: ReturnType<typeof config>["storage"]["s3"],
  ) {
    if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
      throw new Error("S3 storage needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    }
    this.aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, service: "s3" });
  }

  private objectUrl(key: string) {
    return `${this.cfg.endpoint!.replace(/\/$/, "")}/${this.cfg.bucket}/${safeKey(key).split("/").map(encodeURIComponent).join("/")}`;
  }

  publicUrl(key: string): string {
    const base = this.cfg.publicBaseUrl ?? `${this.cfg.endpoint!.replace(/\/$/, "")}/${this.cfg.bucket}`;
    return `${base}/${safeKey(key).split("/").map(encodeURIComponent).join("/")}`;
  }

  async put(key: string, data: Buffer, mime: string): Promise<StoredObject> {
    const res = await this.aws.fetch(this.objectUrl(key), { method: "PUT", body: new Uint8Array(data), headers: { "content-type": mime } });
    if (!res.ok) throw new Error(`S3 upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return { key: safeKey(key), url: this.publicUrl(key), bytes: data.length, mime };
  }

  async putFile(key: string, filePath: string, mime: string): Promise<StoredObject> {
    return this.put(key, await fs.readFile(filePath), mime);
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.aws.fetch(this.objectUrl(key));
    if (!res.ok) throw new Error(`S3 read failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async toLocalFile(key: string, tmpDir: string): Promise<string> {
    const target = path.join(tmpDir, path.basename(safeKey(key)));
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(target, await this.read(key));
    return target;
  }
}

let instance: Storage | undefined;

export function storage(): Storage {
  if (!instance) {
    const cfg = config().storage;
    instance = cfg.driver === "s3" ? new S3Storage(cfg.s3) : new LocalStorage(cfg.localDir);
  }
  return instance;
}

export function resetStorageForTests(): void {
  instance = undefined;
}

export function localMediaPath(key: string): string {
  return path.join(config().storage.localDir, safeKey(key));
}

/** Stream a remote URL to a local file (generation results). */
export async function downloadToFile(url: string, dest: string, fetchImpl: typeof fetch = fetch): Promise<{ path: string; mime: string; bytes: number }> {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url.slice(0, 120)}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
  const stat = await fs.stat(dest);
  return { path: dest, mime: res.headers.get("content-type") ?? "application/octet-stream", bytes: stat.size };
}

export function extensionFor(mime: string, fallback: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("pdf")) return "pdf";
  return fallback;
}

export function mimeForExt(ext: string): string {
  return (
    {
      mp4: "video/mp4",
      mov: "video/quicktime",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      pdf: "application/pdf",
      ass: "text/plain",
    } as Record<string, string>
  )[ext.toLowerCase()] ?? "application/octet-stream";
}
