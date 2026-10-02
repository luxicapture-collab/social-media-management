import path from "node:path";
import { z } from "zod";

/**
 * Environment configuration. Parsed lazily so `next build` works without secrets,
 * and so tests can override process.env before first use.
 */
const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  DATA_DIR: z.string().default("./data"),
  SESSION_SECRET: optional,
  ENCRYPTION_KEY: optional,
  ADMIN_EMAIL: z.string().default("owner@example.com"),
  ADMIN_PASSWORD: optional,
  ADMIN_PASSWORD_HASH: optional,
  DATABASE_URL: optional,
  PGLITE_DIR: optional,
  RUN_WORKER: z.enum(["in-process", "off"]).default("in-process"),
  WORKER_TICK_SECONDS: z.coerce.number().int().min(5).max(600).default(20),
  CRON_SECRET: optional,
  DEMO_MODE: z.enum(["auto", "true", "false"]).default("auto"),
  AGENCY_TIMEZONE: z.string().default("UTC"),
  AGENCY_NAME: z.string().default("Luxi Capture"),

  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  CLAUDE_FALLBACKS: z.enum(["default", "off"]).default("default"),

  HIGGSFIELD_CREDENTIALS: optional,
  HIGGSFIELD_BASE_URL: z.string().default("https://api.higgsfield.ai"),
  ELEVENLABS_API_KEY: optional,
  ELEVENLABS_DEFAULT_VOICE_ID: optional,
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_PUBLIC_BASE_URL: optional,

  META_APP_ID: optional,
  META_APP_SECRET: optional,
  META_GRAPH_VERSION: z.string().default("v25.0"),
  META_LOGIN_CONFIG_ID: optional,
  META_WEBHOOK_VERIFY_TOKEN: optional,

  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  LINKEDIN_API_VERSION: z.string().default("202608"),
  LINKEDIN_SCOPES: z
    .string()
    .default("r_organization_social w_organization_social rw_organization_admin w_member_social openid profile"),

  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,
  X_SCOPES: z.string().default("tweet.read tweet.write users.read offline.access media.write dm.read dm.write"),

  METRICOOL_USER_TOKEN: optional,
  METRICOOL_USER_ID: optional,

  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: z.string().default("mailto:owner@example.com"),
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,

  ALLOW_INSECURE_DEV_SECRETS: bool(false),
});

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig(env: NodeJS.ProcessEnv) {
  const e = EnvSchema.parse(env);
  const dataDir = path.resolve(e.DATA_DIR);
  const isProd = e.NODE_ENV === "production";
  const demo = e.DEMO_MODE === "true" || (e.DEMO_MODE === "auto" && !e.ANTHROPIC_API_KEY);

  const devFallback = (name: string, value: string | undefined, fallback: string) => {
    if (value) return value;
    if (isProd && !e.ALLOW_INSECURE_DEV_SECRETS) {
      throw new Error(`${name} must be set in production. See .env.example.`);
    }
    return fallback;
  };

  return {
    env: e.NODE_ENV,
    isProd,
    demo,
    appUrl: e.APP_URL.replace(/\/$/, ""),
    agencyName: e.AGENCY_NAME,
    agencyTimezone: e.AGENCY_TIMEZONE,
    dataDir,
    sessionSecret: devFallback("SESSION_SECRET", e.SESSION_SECRET, "dev-session-secret-change-me-dev-session-secret"),
    encryptionKey: devFallback("ENCRYPTION_KEY", e.ENCRYPTION_KEY, "dev-encryption-key-change-me"),
    admin: {
      email: e.ADMIN_EMAIL.toLowerCase(),
      password: e.ADMIN_PASSWORD ?? (isProd ? undefined : "luxi-demo"),
      passwordHash: e.ADMIN_PASSWORD_HASH,
    },
    db: {
      url: e.DATABASE_URL,
      pgliteDir: path.resolve(e.PGLITE_DIR ?? path.join(dataDir, "pglite")),
    },
    worker: {
      mode: e.RUN_WORKER,
      tickSeconds: e.WORKER_TICK_SECONDS,
      cronSecret: e.CRON_SECRET,
    },
    claude: {
      apiKey: e.ANTHROPIC_API_KEY,
      model: e.CLAUDE_MODEL,
      fallbacks: e.CLAUDE_FALLBACKS,
    },
    higgsfield: {
      credentials: e.HIGGSFIELD_CREDENTIALS,
      baseUrl: e.HIGGSFIELD_BASE_URL.replace(/\/$/, ""),
    },
    elevenlabs: {
      apiKey: e.ELEVENLABS_API_KEY,
      defaultVoiceId: e.ELEVENLABS_DEFAULT_VOICE_ID,
    },
    ffmpeg: { ffmpeg: e.FFMPEG_PATH, ffprobe: e.FFPROBE_PATH },
    storage: {
      driver: e.STORAGE_DRIVER,
      localDir: path.join(dataDir, "media"),
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
        publicBaseUrl: e.S3_PUBLIC_BASE_URL?.replace(/\/$/, ""),
      },
    },
    meta: {
      appId: e.META_APP_ID,
      appSecret: e.META_APP_SECRET,
      graphVersion: e.META_GRAPH_VERSION,
      loginConfigId: e.META_LOGIN_CONFIG_ID,
      webhookVerifyToken: e.META_WEBHOOK_VERIFY_TOKEN,
    },
    linkedin: {
      clientId: e.LINKEDIN_CLIENT_ID,
      clientSecret: e.LINKEDIN_CLIENT_SECRET,
      apiVersion: e.LINKEDIN_API_VERSION,
      scopes: e.LINKEDIN_SCOPES.split(/\s+/).filter(Boolean),
    },
    x: {
      clientId: e.X_CLIENT_ID,
      clientSecret: e.X_CLIENT_SECRET,
      scopes: e.X_SCOPES.split(/\s+/).filter(Boolean),
    },
    metricool: {
      userToken: e.METRICOOL_USER_TOKEN,
      userId: e.METRICOOL_USER_ID,
    },
    push: {
      publicKey: e.VAPID_PUBLIC_KEY,
      privateKey: e.VAPID_PRIVATE_KEY,
      subject: e.VAPID_SUBJECT,
    },
    telegram: {
      botToken: e.TELEGRAM_BOT_TOKEN,
      chatId: e.TELEGRAM_CHAT_ID,
    },
  };
}

let cached: AppConfig | undefined;

export function config(): AppConfig {
  if (!cached) cached = buildConfig(process.env);
  return cached;
}

/** Test helper: rebuild configuration after mutating process.env. */
export function resetConfigForTests(): void {
  cached = undefined;
}

export function oauthRedirectUri(platform: "meta" | "linkedin" | "x"): string {
  return `${config().appUrl}/api/connect/${platform}/callback`;
}
