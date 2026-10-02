import { CAPTION_RULES } from "./platform-specs";
import type { Format, Platform } from "./types";

export type IssueSeverity = "error" | "warning";

export interface CaptionIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
}

const URL_RE = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi;
// Hashtags in any script (Latin, Persian/Arabic, CJK...), excluding URL fragments.
const HASHTAG_RE = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]+)/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function extractHashtags(text: string): string[] {
  const tags: string[] = [];
  for (const m of text.matchAll(HASHTAG_RE)) tags.push(`#${m[2]}`);
  return tags;
}

export function extractUrls(text: string): string[] {
  return text.match(URL_RE) ?? [];
}

/**
 * Weighted length as X counts it (twitter-text v3): URLs count 23, characters in the
 * Latin/Arabic/Persian/punctuation ranges count 1, emoji and CJK count 2.
 */
export function xWeightedLength(text: string): number {
  let total = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    total += 23;
    return "";
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0) ?? 0;
    if (EMOJI_RE.test(ch)) {
      total += 2;
    } else if (
      (cp >= 0 && cp <= 4351) ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247)
    ) {
      total += 1;
    } else if (cp === 0xfe0f || cp === 0x200d) {
      // variation selectors / zero-width joiners inside emoji sequences
      total += 0;
    } else {
      total += 2;
    }
  }
  return total;
}

/** Phrases that make captions read like generic AI marketing. The agent is told to avoid them; the linter double-checks. */
export const CLICHES = [
  "elevate your",
  "unlock the",
  "unleash",
  "game-changer",
  "game changer",
  "in today's fast-paced",
  "look no further",
  "dive into",
  "take it to the next level",
  "next level",
  "we are thrilled",
  "we're thrilled",
  "discover the magic",
  "embark on",
  "journey of a lifetime",
  "seamless experience",
  "cutting-edge",
  "revolutionize",
  "in the world of",
  "it's not just",
  "say goodbye to",
  "boost your",
  "supercharge",
  "transform your",
];

export function findCliches(text: string): string[] {
  const lower = text.toLowerCase();
  return CLICHES.filter((c) => lower.includes(c));
}

export function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
}

export interface ValidateOptions {
  format: Format;
  /** X Premium accounts can post long-form. */
  xPremium?: boolean;
}

export function validateCaption(platform: Platform, text: string, opts: ValidateOptions): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  const rules = CAPTION_RULES[platform];
  const trimmed = text.trim();

  if (opts.format === "story") {
    if (trimmed.length > 0 && platform === "instagram") {
      issues.push({
        severity: "warning",
        code: "story_caption",
        message: "Stories have no caption; put the words on screen (storyText) instead.",
      });
    }
    return issues;
  }

  if (trimmed.length === 0) {
    issues.push({ severity: "error", code: "empty", message: `${platform} caption is empty.` });
    return issues;
  }

  if (platform === "x") {
    const weighted = xWeightedLength(trimmed);
    if (!opts.xPremium && weighted > rules.maxChars) {
      issues.push({
        severity: "error",
        code: "too_long",
        message: `X post is ${weighted} weighted characters; the limit is ${rules.maxChars}.`,
      });
    }
  } else if ([...trimmed].length > rules.maxChars) {
    issues.push({
      severity: "error",
      code: "too_long",
      message: `${platform} caption is ${[...trimmed].length} characters; the limit is ${rules.maxChars}.`,
    });
  }

  const hook = firstLine(trimmed);
  if (rules.foldChars && [...hook].length > rules.foldChars) {
    issues.push({
      severity: "warning",
      code: "hook_past_fold",
      message: `The first line runs past the "more" fold (${[...hook].length}/${rules.foldChars} chars); the hook must land before it.`,
    });
  }

  const tags = extractHashtags(trimmed);
  if (tags.length > rules.maxHashtags) {
    issues.push({
      severity: platform === "instagram" ? "error" : "warning",
      code: "too_many_hashtags",
      message: `${tags.length} hashtags; ${platform} allows at most ${rules.maxHashtags}.`,
    });
  } else if (tags.length > rules.recommendedHashtags[1]) {
    issues.push({
      severity: "warning",
      code: "hashtags_above_recommended",
      message: `${tags.length} hashtags; ${rules.recommendedHashtags[0]}–${rules.recommendedHashtags[1]} works best on ${platform}.`,
    });
  }
  const dupes = tags.filter((t, i) => tags.findIndex((u) => u.toLowerCase() === t.toLowerCase()) !== i);
  if (dupes.length) {
    issues.push({ severity: "warning", code: "duplicate_hashtags", message: `Duplicate hashtags: ${dupes.join(", ")}` });
  }

  const urls = extractUrls(trimmed);
  if (urls.length) {
    if (rules.linksAllowed === "no") {
      issues.push({
        severity: "warning",
        code: "link_not_clickable",
        message: "Links in Instagram captions are not clickable; point to the bio or a story link sticker.",
      });
    } else if (rules.linksAllowed === "first_comment") {
      issues.push({
        severity: "warning",
        code: "link_in_body",
        message: "Move the outbound link to the first comment; LinkedIn suppresses posts with links in the body.",
      });
    } else if (rules.linksAllowed === "discouraged") {
      issues.push({
        severity: "warning",
        code: "x_link_cost",
        message: "Posts with links cost $0.20 via the X API (vs $0.015) and get less reach; drop the link if you can.",
      });
    }
  }

  const cliches = findCliches(trimmed);
  if (cliches.length) {
    issues.push({
      severity: "warning",
      code: "cliche",
      message: `Reads generic: ${cliches.map((c) => `“${c}”`).join(", ")}. Rewrite in the client's own voice.`,
    });
  }

  return issues;
}

export function hasBlockingIssues(issues: CaptionIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export function validateStoryFrames(frames: Array<{ text: string }>): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  frames.forEach((f, i) => {
    const words = f.text.trim().split(/\s+/).filter(Boolean).length;
    if (words > 10) {
      issues.push({
        severity: "warning",
        code: "story_frame_wordy",
        message: `Story frame ${i + 1} has ${words} words; keep on-screen text to 10 words or fewer.`,
      });
    }
  });
  return issues;
}
