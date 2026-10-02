/**
 * Shared domain vocabulary. Pure types and constants — no I/O.
 */

export const PLATFORMS = ["instagram", "facebook", "linkedin", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
};

/** What a piece of content *is*. Platform-specific publish types are derived from it. */
export const FORMATS = ["reel", "story", "post", "carousel"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<Format, string> = {
  reel: "Reel",
  story: "Story",
  post: "Post",
  carousel: "Carousel",
};

/** Content lifecycle, mirroring the Luxi desk: concept → greenlit → producing → review → approved → scheduled → live → analyzed. */
export const CONTENT_STATUSES = [
  "concept",
  "greenlit",
  "producing",
  "review",
  "approved",
  "scheduled",
  "live",
  "analyzed",
  "revise",
  "dropped",
  "failed",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const SCENARIO_STATUSES = ["new", "planning", "planned", "failed"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export const PUBLICATION_STATUSES = ["pending", "scheduled", "publishing", "published", "failed", "canceled"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const GOAL_KPIS = [
  "followers",
  "reach",
  "views",
  "engagement_rate",
  "profile_visits",
  "link_clicks",
  "leads",
  "saves",
  "shares",
] as const;
export type GoalKpi = (typeof GOAL_KPIS)[number];

export const GOAL_KPI_LABEL: Record<GoalKpi, string> = {
  followers: "Followers",
  reach: "Reach",
  views: "Views",
  engagement_rate: "Engagement rate",
  profile_visits: "Profile visits",
  link_clicks: "Link clicks",
  leads: "Leads / DMs",
  saves: "Saves",
  shares: "Shares",
};

export type PaceStatus = "ahead" | "on_track" | "behind" | "off_track" | "unknown";

export const BOTTLENECKS = ["distribution", "hook", "resonance", "conversion"] as const;
export type Bottleneck = (typeof BOTTLENECKS)[number];

export const ANGLES = [
  "transformation",
  "behind_the_scenes",
  "teach_one_thing",
  "pov_story",
  "social_proof",
  "myth_vs_reality",
  "trend_remix",
  "surreal_hook",
  "founder_voice",
  "challenge",
] as const;
export type Angle = (typeof ANGLES)[number];

export type InboxKind = "comment" | "dm" | "mention";
export type InboxStatus = "new" | "drafted" | "sent" | "needs_you" | "skipped" | "hidden" | "failed";
export type InboxCategory = "question" | "praise" | "lead" | "complaint" | "spam" | "sensitive" | "other";

export type AlertImportance = "high" | "medium" | "info";
export type AlertKind = "watch" | "health" | "goal" | "credits" | "publish" | "system" | "community";

export type ReplyPolicy = "auto" | "draft" | "off";

export interface ClientBrief {
  positioning: string;
  services: string;
  voice: string;
  audience: string;
  pillars: string[];
  visualGrammar: string;
  guardrails: string[];
  ctas: string[];
  hashtags: string[];
  competitors: string[];
  notes: string;
}

export interface ClientAutonomy {
  replies: ReplyPolicy;
  autoApplyMicroPivots: boolean;
  weeklyBudgetUsd: number;
  cadence: {
    reelsPerWeek: number;
    feedPostsPerWeek: number;
    storiesPerWeek: number;
    linkedinPerWeek: number;
    xPerWeek: number;
  };
}

export const DEFAULT_BRIEF: ClientBrief = {
  positioning: "",
  services: "",
  voice: "",
  audience: "",
  pillars: [],
  visualGrammar: "",
  guardrails: [],
  ctas: [],
  hashtags: [],
  competitors: [],
  notes: "",
};

export const DEFAULT_AUTONOMY: ClientAutonomy = {
  replies: "auto",
  autoApplyMicroPivots: true,
  weeklyBudgetUsd: 150,
  cadence: { reelsPerWeek: 3, feedPostsPerWeek: 2, storiesPerWeek: 7, linkedinPerWeek: 2, xPerWeek: 3 },
};

/** Normalised performance numbers for one published post. Missing = the platform didn't report it. */
export interface PostMetrics {
  impressions?: number;
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  profileVisits?: number;
  follows?: number;
  avgWatchSec?: number;
  retention3s?: number;
  replies?: number;
  videoViews?: number;
}

/** Account-level daily metrics. */
export interface AccountMetrics {
  followers?: number;
  reach?: number;
  views?: number;
  impressions?: number;
  profileVisits?: number;
  linkClicks?: number;
  engaged?: number;
  interactions?: number;
}

export interface AudienceBreakdown {
  age?: Record<string, number>;
  gender?: Record<string, number>;
  cities?: Array<{ name: string; value: number }>;
  countries?: Array<{ name: string; value: number }>;
  industries?: Array<{ name: string; value: number }>;
  seniorities?: Array<{ name: string; value: number }>;
  functions?: Array<{ name: string; value: number }>;
}

export interface QuoteItem {
  tool: string;
  model: string;
  units: number;
  unit: string;
  usd: number;
  note?: string;
}

export interface Quote {
  items: QuoteItem[];
  totalUsd: number;
  currency: "USD";
  estimated: true;
}
