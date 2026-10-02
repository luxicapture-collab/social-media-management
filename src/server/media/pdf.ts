/**
 * Minimal PDF writer that embeds JPEG pages without re-encoding (DCTDecode). Used for LinkedIn
 * document carousels, which are uploaded as PDFs. One image per page, page size = image size.
 */

export function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("Not a JPEG");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  throw new Error("JPEG size not found");
}

export function imagesToPdf(jpegs: Buffer[], title = "Carousel"): Buffer {
  if (!jpegs.length) throw new Error("imagesToPdf: no pages");
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    chunks.push(buf);
    length += buf.length;
  };
  const obj = (n: number, body: Buffer | string, stream?: Buffer) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    push(body);
    if (stream) {
      push("\nstream\n");
      push(stream);
      push("\nendstream");
    }
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1: catalog, 2: pages, 3: info, then per page: page, image, content (3 objects each)
  const pageIds = jpegs.map((_, i) => 4 + i * 3);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${jpegs.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const safeTitle = title.replace(/[()\\]/g, "").slice(0, 120);
  obj(3, `<< /Title (${safeTitle}) /Producer (Luxi Social Agent) >>`);
  jpegs.forEach((jpg, i) => {
    const { width, height } = jpegSize(jpg);
    const pageId = pageIds[i];
    const imgId = pageId + 1;
    const contentId = pageId + 2;
    const content = Buffer.from(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`, "latin1");
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    obj(imgId, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
    obj(contentId, `<< /Length ${content.length} >>`, content);
  });
  const total = 4 + jpegs.length * 3;
  const xrefOffset = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(chunks);
}
