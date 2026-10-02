import type { TextOverlay } from "@/domain/schemas";
import { isRtl } from "@/domain/text";

/**
 * ASS (Advanced SubStation Alpha) builder for burned-in typography: hook titles, key points,
 * CTAs and word-synced captions. libass handles complex scripts (Persian/Arabic) via HarfBuzz
 * and FriBidi, and the bundled fonts give a consistent cinematic look.
 */

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Theme {
  /** ASS colours are &HAABBGGRR. Use hex #RRGGBB here; conversion is handled. */
  primary: string;
  accent: string;
  shadow: string;
  titleFont: string;
  bodyFont: string;
  ctaFont: string;
  rtlFont: string;
}

export const DEFAULT_THEME: Theme = {
  primary: "#FFFFFF",
  accent: "#F2C14E",
  shadow: "#000000",
  titleFont: "Bebas Neue",
  bodyFont: "Inter",
  ctaFont: "Playfair Display",
  rtlFont: "Vazirmatn",
};

export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

export function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeText(t: string): string {
  return t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, "\\N");
}

/** Group character-level alignment into words. */
export function wordsFromAlignment(a: { characters: string[]; starts: number[]; ends: number[] }): Word[] {
  const words: Word[] = [];
  let current: Word | null = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (!current) current = { text: ch, start: a.starts[i], end: a.ends[i] };
    else {
      current.text += ch;
      current.end = a.ends[i];
    }
  });
  if (current) words.push(current);
  return words;
}

/** Evenly distribute words across a duration (fallback when the TTS returned no timestamps). */
export function wordsFromScript(script: string, startSec: number, durationSec: number): Word[] {
  const tokens = script.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => Math.max(2, [...t].length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = startSec;
  return tokens.map((text, i) => {
    const d = (weights[i] / total) * durationSec;
    const w = { text, start: t, end: t + d };
    t += d;
    return w;
  });
}

/** Caption chunks of 2–4 words, breaking on punctuation and long gaps. */
export function chunkWords(words: Word[], maxWords = 3, maxChars = 18): Word[][] {
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const len = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0;
    if (cur.length && (cur.length >= maxWords || len > maxChars || gap > 0.6)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?،؟,;:]$/.test(w.text)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export interface AssInput {
  width: number;
  height: number;
  overlays: TextOverlay[];
  captions?: Word[];
  /** Title cards: full-screen text over a dark background. */
  titleCards?: Array<{ text: string; start: number; end: number }>;
  theme?: Theme;
  language?: string;
}

export function buildAss(input: AssInput): string {
  const { width: W, height: H } = input;
  const theme = input.theme ?? DEFAULT_THEME;
  const rtlAll = input.language === "fa" || input.language === "ar";
  const scale = W / 1080;
  const fs = (px: number) => Math.round(px * scale);
  const primary = assColor(theme.primary);
  const accent = assColor(theme.accent);
  const shadow = assColor(theme.shadow, 0x40);
  const boxBack = assColor("#000000", 0x6e);

  const safeTop = Math.round(H * 0.14);
  const safeBottom = Math.round(H * 0.22);
  const marginH = Math.round(W * 0.08);

  // Style fields: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic,
  // Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  const style = (name: string, font: string, size: number, prim: string, sec: string, bold: number, italic: number, border: number, outline: number, shad: number, align: number, marginV: number, back = shadow) =>
    `Style: ${name},${font},${size},${prim},${sec},${shadow},${back},${bold},${italic},0,0,100,100,0,0,${border},${outline},${shad},${align},${marginH},${marginH},${marginV},1`;

  const titleFont = rtlAll ? theme.rtlFont : theme.titleFont;
  const bodyFont = rtlAll ? theme.rtlFont : theme.bodyFont;
  const ctaFont = rtlAll ? theme.rtlFont : theme.ctaFont;

  const styles = [
    style("Hook", titleFont, fs(rtlAll ? 92 : 118), primary, primary, -1, 0, 1, fs(3), fs(4), 5, 0),
    style("Point", bodyFont, fs(58), primary, primary, -1, 0, 3, fs(18), 0, 2, safeBottom + fs(40), boxBack),
    style("Cta", ctaFont, fs(84), primary, primary, -1, rtlAll ? 0 : -1, 1, fs(2), fs(4), 5, 0),
    style("Caption", bodyFont, fs(68), accent, primary, -1, 0, 1, fs(6), fs(2), 2, safeBottom),
    style("CaptionRtl", theme.rtlFont, fs(66), primary, primary, -1, 0, 1, fs(6), fs(2), 2, safeBottom),
    style("Title", titleFont, fs(rtlAll ? 96 : 128), primary, primary, -1, 0, 1, 0, 0, 5, 0),
  ];

  const events: string[] = [];
  const dialog = (layer: number, start: number, end: number, styleName: string, text: string) =>
    `Dialogue: ${layer},${assTime(start)},${assTime(end)},${styleName},,0,0,0,,${text}`;

  for (const card of input.titleCards ?? []) {
    const dur = Math.max(0.3, card.end - card.start);
    events.push(dialog(0, card.start, card.end, "Title", `{\\fad(180,220)\\blur0.6\\t(0,${Math.round(dur * 1000)},\\fscx104\\fscy104)}${escapeText(card.text)}`));
  }

  for (const o of input.overlays) {
    const start = Math.max(0, o.startSec);
    const end = Math.max(start + 0.4, o.endSec);
    const text = escapeText(o.text);
    const y = o.position === "top" ? safeTop + fs(80) : o.position === "bottom" ? H - safeBottom - fs(160) : Math.round(H * 0.44);
    if (o.role === "hook") {
      events.push(dialog(2, start, end, "Hook", `{\\an5\\pos(${W / 2},${y})\\fad(120,200)\\fscx88\\fscy88\\t(0,220,\\fscx100\\fscy100)}${text}`));
    } else if (o.role === "cta") {
      events.push(dialog(2, start, end, "Cta", `{\\an5\\pos(${W / 2},${y})\\fad(250,250)}${text}`));
    } else if (o.role === "point") {
      // Burned captions own the lower third, so points move to the top third when captions are on.
      const position = input.captions?.length && o.position === "bottom" ? "top" : o.position;
      const align = position === "top" ? 8 : position === "center" ? 5 : 2;
      const yPoint = position === "top" ? safeTop + fs(40) : position === "center" ? Math.round(H * 0.5) : H - safeBottom - fs(60);
      events.push(dialog(1, start, end, "Point", `{\\an${align}\\move(${W / 2},${yPoint + fs(30)},${W / 2},${yPoint},0,240)\\fad(180,180)}${text}`));
    } else {
      events.push(dialog(1, start, end, "Point", `{\\an2\\pos(${W / 2},${H - safeBottom})\\fad(120,120)}${text}`));
    }
  }

  if (input.captions?.length) {
    for (const chunk of chunkWords(input.captions)) {
      const start = chunk[0].start;
      const end = chunk[chunk.length - 1].end + 0.08;
      const rtl = rtlAll || chunk.some((w) => isRtl(w.text));
      if (rtl) {
        events.push(dialog(3, start, end, "CaptionRtl", `{\\fad(60,60)}${escapeText(chunk.map((w) => w.text).join(" "))}`));
      } else {
        // Karaoke fill: each word turns accent colour as it is spoken (SecondaryColour → PrimaryColour).
        const body = chunk
          .map((w, i) => {
            const next = chunk[i + 1];
            const dur = Math.max(5, Math.round(((next ? next.start : w.end) - w.start) * 100));
            return `{\\kf${dur}}${escapeText(w.text.toUpperCase())}`;
          })
          .join(" ");
        events.push(dialog(3, start, end, "Caption", `{\\fad(40,60)}${body}`));
      }
    }
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

/** Single-frame typography for carousel / story / post stills. */
export function buildStillAss(input: { width: number; height: number; title: string; body: string; theme?: Theme; language?: string; index?: number; total?: number }): string {
  const { width: W, height: H } = input;
  const theme = input.theme ?? DEFAULT_THEME;
  const rtl = input.language === "fa" || isRtl(input.title + input.body);
  const scale = W / 1080;
  const fs = (px: number) => Math.round(px * scale);
  const margin = Math.round(W * 0.08);
  const primary = assColor(theme.primary);
  const shadow = assColor(theme.shadow, 0x30);
  const boxBack = assColor("#000000", 0x60);
  const titleFont = rtl ? theme.rtlFont : theme.ctaFont;
  const bodyFont = rtl ? theme.rtlFont : theme.bodyFont;
  const lines: string[] = [];
  if (input.title) {
    lines.push(`Dialogue: 1,0:00:00.00,0:00:10.00,StillTitle,,0,0,0,,{\\an1\\pos(${margin},${Math.round(H * 0.78)})}${escapeText(input.title)}`);
  }
  if (input.body) {
    lines.push(`Dialogue: 1,0:00:00.00,0:00:10.00,StillBody,,0,0,0,,{\\an7\\pos(${margin},${Math.round(H * 0.8)})}${escapeText(input.body)}`);
  }
  if (input.total && input.total > 1 && input.index !== undefined) {
    lines.push(`Dialogue: 1,0:00:00.00,0:00:10.00,StillCounter,,0,0,0,,{\\an9\\pos(${W - margin},${margin})}${input.index + 1}/${input.total}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: StillTitle,${titleFont},${fs(rtl ? 84 : 96)},${primary},${primary},${shadow},${shadow},-1,${rtl ? 0 : -1},0,0,100,100,0,0,1,${fs(2)},${fs(5)},1,${margin},${margin},0,1
Style: StillBody,${bodyFont},${fs(44)},${primary},${primary},${shadow},${boxBack},0,0,0,0,100,100,0,0,3,${fs(14)},0,7,${margin},${margin},0,1
Style: StillCounter,${theme.bodyFont},${fs(34)},${primary},${primary},${shadow},${shadow},-1,0,0,0,100,100,0,0,1,${fs(2)},${fs(2)},9,${margin},${margin},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}
