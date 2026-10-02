import { eq } from "drizzle-orm";
import type { AlertImportance } from "@/domain/types";
import { zonedParts } from "@/domain/time";
import { config } from "../config";
import { getDb } from "../db/client";
import { pushSubscriptions } from "../db/schema";
import { errorMessage, log } from "../log";
import { getNotificationPrefs } from "../settings";

export interface Notification {
  title: string;
  body: string;
  /** Relative app URL opened when the notification is tapped. */
  url?: string;
  importance?: AlertImportance;
  tag?: string;
  /** Bypass quiet hours (e.g. a failed publish). */
  urgent?: boolean;
}

const RANK: Record<AlertImportance, number> = { info: 0, medium: 1, high: 2 };

export function inQuietHours(now: Date, tz: string, quiet: { start: number; end: number } | null): boolean {
  if (!quiet) return false;
  const h = zonedParts(now, tz).hour;
  return quiet.start <= quiet.end ? h >= quiet.start && h < quiet.end : h >= quiet.start || h < quiet.end;
}

/** Fan a notification out to every enabled channel. Never throws. */
export async function notify(n: Notification): Promise<{ push: number; telegram: boolean }> {
  const prefs = await getNotificationPrefs();
  const importance = n.importance ?? "medium";
  if (RANK[importance] < RANK[prefs.minImportance]) return { push: 0, telegram: false };
  if (!n.urgent && importance !== "high" && inQuietHours(new Date(), config().agencyTimezone, prefs.quietHours)) {
    return { push: 0, telegram: false };
  }
  let push = 0;
  let telegram = false;
  if (prefs.push) push = await sendPushToAll(n).catch(() => 0);
  if (prefs.telegram) telegram = await sendTelegram(n).catch(() => false);
  return { push, telegram };
}

export async function sendPushToAll(n: Notification): Promise<number> {
  const cfg = config().push;
  if (!cfg.publicKey || !cfg.privateKey) return 0;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  const db = await getDb();
  const subs = await db.select().from(pushSubscriptions);
  let sent = 0;
  const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url ?? "/", tag: n.tag });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12 });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      } else {
        log.warn("push.failed", { error: errorMessage(err) });
      }
    }
  }
  return sent;
}

export async function sendTelegram(n: Notification): Promise<boolean> {
  const { botToken, chatId } = config().telegram;
  if (!botToken || !chatId) return false;
  const link = n.url ? `\n${config().appUrl}${n.url}` : "";
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: `${n.title}\n${n.body}${link}`.slice(0, 4000), disable_web_page_preview: true }),
  });
  if (!res.ok) log.warn("telegram.failed", { status: res.status });
  return res.ok;
}
