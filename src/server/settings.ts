import { eq } from "drizzle-orm";
import { DEFAULT_PRICES, type PriceTable } from "@/domain/quotes";
import { getDb } from "./db/client";
import { settings } from "./db/schema";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return fallback;
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    // Shallow-merge so new default keys appear after upgrades.
    return { ...fallback, ...(row.value as object) } as T;
  }
  return row.value as T;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key, value: value as object })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedAt: new Date() } });
}

export async function getPrices(): Promise<PriceTable> {
  const stored = await getSetting<Partial<PriceTable>>("prices", {});
  return {
    ...DEFAULT_PRICES,
    ...stored,
    models: { ...DEFAULT_PRICES.models, ...(stored.models ?? {}) },
    elevenlabs: { ...DEFAULT_PRICES.elevenlabs, ...(stored.elevenlabs ?? {}) },
    claude: { ...DEFAULT_PRICES.claude, ...(stored.claude ?? {}) },
  };
}

export interface NotificationPrefs {
  push: boolean;
  telegram: boolean;
  /** Only send pushes for these importance levels. */
  minImportance: "high" | "medium" | "info";
  morningBrief: boolean;
  quietHours: { start: number; end: number } | null;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  push: true,
  telegram: true,
  minImportance: "medium",
  morningBrief: true,
  quietHours: { start: 23, end: 7 },
};

export function getNotificationPrefs(): Promise<NotificationPrefs> {
  return getSetting("notifications", DEFAULT_NOTIFICATION_PREFS);
}
