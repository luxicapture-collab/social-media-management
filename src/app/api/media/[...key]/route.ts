import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { localMediaPath, mimeForExt, safeKey, storage } from "@/server/media/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A web stream over a file that reads only as fast as the client consumes (pull-based) and stops
 * reading when the client goes away. Browsers cancel video range requests constantly while seeking;
 * Readable.toWeb throws "Controller is already closed" in that case.
 */
function fileStream(file: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const node = createReadStream(file, range);
  const chunks = node[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  let finished = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (finished) return;
        if (done) {
          finished = true;
          controller.close();
        } else {
          controller.enqueue(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        }
      } catch (err) {
        if (!finished) {
          finished = true;
          controller.error(err);
        }
      }
    },
    cancel() {
      finished = true;
      node.destroy();
    },
  });
}

/**
 * Public media for the local storage driver. Platforms (Instagram especially) download post media
 * from a public URL, and phones need byte ranges to play video, so this supports HEAD and Range.
 * Keys contain random ids; nothing here lists or reveals other files.
 */
async function serve(req: NextRequest, params: Promise<{ key: string[] }>, head: boolean): Promise<Response> {
  const { key } = await params;
  let k: string;
  try {
    k = safeKey(key.join("/"));
  } catch {
    return NextResponse.json({ error: "Bad key" }, { status: 400 });
  }
  if (storage().driver === "s3") return NextResponse.redirect(storage().publicUrl(k), 302);

  const file = localMediaPath(k);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const size = info.size;
  const headers: Record<string, string> = {
    "content-type": mimeForExt(path.extname(file).slice(1).toLowerCase()),
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "last-modified": info.mtime.toUTCString(),
  };

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m && m[1] !== "" ? Number(m[1]) : NaN;
    let end = m && m[2] !== "" ? Number(m[2]) : NaN;
    if (m && Number.isNaN(start) && !Number.isNaN(end)) {
      start = Math.max(0, size - end); // suffix range: the last N bytes
      end = size - 1;
    } else if (!Number.isNaN(start) && (Number.isNaN(end) || end >= size)) {
      end = size - 1;
    }
    if (!m || Number.isNaN(start) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    const partial = { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) };
    if (head) return new Response(null, { status: 206, headers: partial });
    return new Response(fileStream(file, { start, end }), { status: 206, headers: partial });
  }

  const full = { ...headers, "content-length": String(size) };
  if (head) return new Response(null, { status: 200, headers: full });
  return new Response(fileStream(file), { status: 200, headers: full });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  return serve(req, ctx.params, false);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  return serve(req, ctx.params, true);
}
