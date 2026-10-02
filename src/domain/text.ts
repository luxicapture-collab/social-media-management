export function slugify(input: string, max = 48): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "item";
}

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const PERSIAN_ONLY = /[پچژگکی]/;
const HEBREW = /[֐-׿]/;

export function isRtl(text: string): boolean {
  return ARABIC_SCRIPT.test(text) || HEBREW.test(text);
}

/** Cheap language guess used to answer comments in the commenter's language. */
export function guessLanguage(text: string): string {
  if (ARABIC_SCRIPT.test(text)) return PERSIAN_ONLY.test(text) ? "fa" : "ar";
  if (HEBREW.test(text)) return "he";
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[çğıöşü]/i.test(text) && /\b(ve|bir|bu|çok)\b/i.test(text)) return "tr";
  if (/\b(el|los|las|que|para|muy)\b/i.test(text) && /[ñáéíóú]/i.test(text)) return "es";
  if (/\b(le|les|des|est|très|pour)\b/i.test(text)) return "fr";
  if (/\b(und|ist|nicht|sehr|für)\b/i.test(text)) return "de";
  return "en";
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Rough speaking time for a voiceover script (words per second differ by language). */
export function speakingSeconds(script: string, language = "en"): number {
  const wps = language === "fa" || language === "ar" ? 2.2 : 2.6;
  return wordCount(script) / wps;
}

/** Strip HTML to readable text (for change watching). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** Lines present in `next` but not in `prev` — the "what's new" of a changelog page. */
export function addedLines(prev: string, next: string): string[] {
  const seen = new Set(prev.split("\n").map((l) => l.trim()));
  return next
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !seen.has(l));
}
