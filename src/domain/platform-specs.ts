import type { Format, Platform } from "./types";

export interface MediaSpec {
  width: number;
  height: number;
  aspect: string;
  maxDurationSec?: number;
  minDurationSec?: number;
}

export interface CaptionRules {
  maxChars: number;
  /** Characters visible before the "more" fold. */
  foldChars?: number;
  maxHashtags: number;
  recommendedHashtags: [number, number];
  linksAllowed: "yes" | "first_comment" | "discouraged" | "no";
}

/** Which formats each platform can carry, and what the native publish type is called. */
export const NATIVE_TYPE: Record<Platform, Partial<Record<Format, string>>> = {
  instagram: { reel: "REELS", story: "STORIES", post: "FEED", carousel: "CAROUSEL" },
  facebook: { reel: "REEL", story: "STORY", post: "POST", carousel: "ALBUM" },
  linkedin: { reel: "VIDEO", post: "IMAGE", carousel: "DOCUMENT" },
  x: { reel: "VIDEO", post: "IMAGE", carousel: "IMAGES" },
};

export function supportsFormat(platform: Platform, format: Format): boolean {
  return Boolean(NATIVE_TYPE[platform][format]);
}

export const CAPTION_RULES: Record<Platform, CaptionRules> = {
  instagram: { maxChars: 2200, foldChars: 125, maxHashtags: 5, recommendedHashtags: [3, 5], linksAllowed: "no" },
  facebook: { maxChars: 63206, foldChars: 240, maxHashtags: 3, recommendedHashtags: [0, 2], linksAllowed: "yes" },
  linkedin: { maxChars: 3000, foldChars: 210, maxHashtags: 5, recommendedHashtags: [0, 3], linksAllowed: "first_comment" },
  x: { maxChars: 280, maxHashtags: 2, recommendedHashtags: [0, 1], linksAllowed: "discouraged" },
};

const VERTICAL: MediaSpec = { width: 1080, height: 1920, aspect: "9:16" };
const PORTRAIT: MediaSpec = { width: 1080, height: 1350, aspect: "4:5" };

/** Delivery spec for each platform × format. The renderer derives every variant from one master. */
export function mediaSpec(platform: Platform, format: Format): MediaSpec {
  if (format === "reel") {
    if (platform === "instagram") return { ...VERTICAL, minDurationSec: 3, maxDurationSec: 900 };
    if (platform === "facebook") return { ...VERTICAL, minDurationSec: 3, maxDurationSec: 90 };
    if (platform === "x") return { ...PORTRAIT, maxDurationSec: 140 };
    return { ...PORTRAIT, minDurationSec: 3, maxDurationSec: 600 };
  }
  if (format === "story") return { ...VERTICAL, maxDurationSec: 60 };
  return PORTRAIT;
}

export function aspectToSize(aspect: string): { width: number; height: number } {
  switch (aspect) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "4:5":
      return { width: 1080, height: 1350 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "3:4":
      return { width: 1080, height: 1440 };
    default:
      return { width: 1080, height: 1920 };
  }
}

/** API costs that are not generation credits but still belong in a quote. */
export const PLATFORM_API_COST_USD = {
  x: { post: 0.015, postWithLink: 0.2, reply: 0.01, postRead: 0.005, dmRead: 0.01, dmSend: 0.015, userRead: 0.01 },
} as const;
