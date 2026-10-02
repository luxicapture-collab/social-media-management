import type { AccountMetrics, AudienceBreakdown, Format, InboxKind, Platform, PostMetrics } from "@/domain/types";

/** Decrypted connection handed to adapters. */
export interface ConnectionCtx {
  id: string;
  clientId: string;
  platform: Platform | "metricool";
  accountId: string;
  accountName?: string | null;
  handle?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  meta: Record<string, unknown>;
  mode: "live" | "demo";
}

export interface PublishMedia {
  kind: "video" | "image" | "pdf";
  url: string;
  /** Local copy for platforms that need the bytes uploaded (LinkedIn, X). */
  localPath?: string;
  mime: string;
  coverUrl?: string;
  coverAtMs?: number;
  altText?: string;
  bytes?: number;
}

export interface PublishRequest {
  platform: Platform;
  format: Format;
  caption: string;
  media: PublishMedia[];
  firstComment?: string;
  trialReel?: boolean;
  aiGenerated: boolean;
  /** Document title (LinkedIn) or video title (Facebook). */
  title?: string;
  scheduledAt: Date;
  timezone: string;
  /** Stories that need interactive stickers must be finished by hand in the app. */
  needsManualFinish?: boolean;
}

export interface PublishResult {
  externalId: string;
  permalink?: string;
  publishedAt: Date;
  /** True when the post was handed to a scheduler (Metricool) rather than published now. */
  scheduledRemotely?: boolean;
  note?: string;
}

export interface InboxMessage {
  kind: InboxKind;
  externalId: string;
  threadId?: string;
  parentExternalId?: string;
  postExternalId?: string;
  authorName?: string;
  authorHandle?: string;
  authorId?: string;
  text: string;
  receivedAt: Date;
  permalink?: string;
  raw?: Record<string, unknown>;
}

export interface ReplyTarget {
  kind: InboxKind;
  externalId: string;
  threadId?: string | null;
  authorId?: string | null;
  postExternalId?: string | null;
}

export interface HealthResult {
  ok: boolean;
  message?: string;
  expiresAt?: Date | null;
}

export interface PostRef {
  externalId: string;
  format: Format;
  publishedAt: Date;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  publish(conn: ConnectionCtx, req: PublishRequest): Promise<PublishResult>;
  postMetrics(conn: ConnectionCtx, posts: PostRef[]): Promise<Record<string, PostMetrics>>;
  /** Totals for one local day (since/until bound the day in UTC). */
  accountMetrics(conn: ConnectionCtx, since: Date, until: Date): Promise<AccountMetrics>;
  audience(conn: ConnectionCtx): Promise<AudienceBreakdown | null>;
  listInbox(conn: ConnectionCtx, since: Date, recentPosts: PostRef[]): Promise<InboxMessage[]>;
  reply(conn: ConnectionCtx, target: ReplyTarget, text: string): Promise<{ externalId: string }>;
  hide?(conn: ConnectionCtx, target: ReplyTarget): Promise<void>;
  health(conn: ConnectionCtx): Promise<HealthResult>;
  /** Native posts published since `since` (used to match posts published through Metricool). */
  recentPublished?(conn: ConnectionCtx, since: Date): Promise<Array<{ externalId: string; caption: string; publishedAt: Date; permalink?: string }>>;
}

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly opts: { retryable: boolean; authExpired?: boolean; permission?: boolean; status?: number; code?: number | string } = { retryable: false },
  ) {
    super(message);
    this.name = "PlatformError";
  }
}
