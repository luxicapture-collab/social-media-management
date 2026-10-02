import { and, eq, inArray, lt } from "drizzle-orm";
import { assessChange } from "@/agent/watcher";
import { getLLM } from "@/agent/llm";
import { addedLines, htmlToText } from "@/domain/text";
import { logRun, raiseAlert } from "../activity";
import { config } from "../config";
import { newId, sha256Hex } from "../crypto";
import { getDb } from "../db/client";
import { alerts, connections, contentItems, inboxItems, publications, watchSources } from "../db/schema";
import { ElevenLabsClient } from "../generation/elevenlabs";
import { getKnowledge, proposeKnowledgeUpdate, type KnowledgeKey } from "../knowledge";
import { errorMessage, log } from "../log";
import { notify } from "../notify";
import { adapterFor } from "../platforms/registry";
import type { Platform } from "@/domain/types";
import { freshCtx, markConnectionHealthy, recordConnectionFailure } from "../services/connections";

export const DEFAULT_WATCH_SOURCES: Array<{ name: string; url: string; scope: "platform" | "tool" | "industry" }> = [
  { name: "Meta Graph API changelog", url: "https://developers.facebook.com/docs/graph-api/changelog/", scope: "platform" },
  { name: "Instagram Platform changelog", url: "https://developers.facebook.com/docs/instagram-platform/changelog/", scope: "platform" },
  { name: "LinkedIn Marketing API recent changes", url: "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/recent-changes", scope: "platform" },
  { name: "X API changelog", url: "https://docs.x.com/changelog", scope: "platform" },
  { name: "Instagram creators news", url: "https://creators.instagram.com/blog", scope: "industry" },
  { name: "ElevenLabs changelog", url: "https://elevenlabs.io/docs/changelog", scope: "tool" },
  { name: "Higgsfield API docs", url: "https://docs.higgsfield.ai/docs", scope: "tool" },
];

export async function ensureWatchSources(): Promise<void> {
  const db = await getDb();
  const existing = new Set((await db.select({ url: watchSources.url }).from(watchSources)).map((r) => r.url));
  for (const s of DEFAULT_WATCH_SOURCES) {
    if (!existing.has(s.url)) await db.insert(watchSources).values({ id: newId("src"), ...s });
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "LuxiSocialAgent/1.0 (+change watch)", accept: "text/html,application/xhtml+xml,application/rss+xml" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return htmlToText(await res.text()).slice(0, 200_000);
}

/** Check each watched source; file only changes that matter. */
export async function checkSources(): Promise<{ checked: number; changed: number; filed: number }> {
  await ensureWatchSources();
  const db = await getDb();
  const sources = await db.select().from(watchSources).where(eq(watchSources.enabled, true));
  const playbook = await getKnowledge("watch");
  let changed = 0;
  let filed = 0;
  for (const s of sources) {
    try {
      const text = await fetchText(s.url);
      const hash = sha256Hex(text);
      if (s.lastHash && s.lastHash !== hash) {
        const added = addedLines(s.lastContent ?? "", text).join("\n");
        if (added.trim().length > 40) {
          changed++;
          const verdict = await assessChange(getLLM(), { sourceName: s.name, url: s.url, scope: s.scope, addedText: added, playbook });
          if (verdict.relevant) {
            const isNew = await raiseAlert({ kind: "watch", source: s.name, title: verdict.title, summary: verdict.summary, action: verdict.action, importance: verdict.importance, url: s.url, dedupeKey: `watch:${s.id}:${hash.slice(0, 12)}` });
            if (isNew) filed++;
            if (verdict.playbookUpdate) {
              await proposeKnowledgeUpdate({ key: verdict.playbookUpdate.key as KnowledgeKey, summary: verdict.title, addition: verdict.playbookUpdate.addition, reason: verdict.summary, sourceUrl: s.url });
            }
          }
        }
      }
      await db
        .update(watchSources)
        .set({ lastHash: hash, lastContent: text.slice(0, 120_000), lastCheckedAt: new Date(), lastError: null, ...(s.lastHash && s.lastHash !== hash ? { lastChangedAt: new Date() } : {}) })
        .where(eq(watchSources.id, s.id));
    } catch (err) {
      await db.update(watchSources).set({ lastCheckedAt: new Date(), lastError: errorMessage(err).slice(0, 300) }).where(eq(watchSources.id, s.id));
    }
  }
  return { checked: sources.length, changed, filed };
}

/** Connections: token validity, expiry within 7 days. */
export async function checkConnections(): Promise<number> {
  const db = await getDb();
  const conns = await db.select().from(connections);
  let problems = 0;
  for (const conn of conns) {
    if (conn.platform === "metricool") continue;
    try {
      const ctx = await freshCtx(conn);
      const health = await adapterFor(conn.platform as Platform, ctx).health(ctx);
      if (health.ok) await markConnectionHealthy(conn);
      else {
        problems++;
        await recordConnectionFailure(conn, new Error(health.message ?? "health check failed"));
        await raiseAlert({ kind: "health", source: conn.platform, title: `${conn.platform} connection problem: ${conn.accountName ?? conn.accountId}`, summary: health.message ?? "The account didn't respond as expected.", action: "Reconnect the account from the client page.", importance: "high", url: `/clients/${conn.clientId}`, clientId: conn.clientId, dedupeKey: `health:${conn.id}:${new Date().toISOString().slice(0, 10)}` });
      }
      const expires = ctx.tokenExpiresAt;
      if (expires && !ctx.refreshToken && expires.getTime() - Date.now() < 7 * 86_400_000) {
        problems++;
        await raiseAlert({ kind: "health", source: conn.platform, title: `${conn.platform} access expires ${expires.toISOString().slice(0, 10)}`, summary: `The login for ${conn.accountName ?? conn.accountId} expires within 7 days and can't be refreshed automatically.`, action: "Reconnect before it expires.", importance: "high", url: `/clients/${conn.clientId}`, clientId: conn.clientId, dedupeKey: `expiry:${conn.id}:${expires.toISOString().slice(0, 10)}` });
      }
    } catch (err) {
      problems++;
      await recordConnectionFailure(conn, err);
    }
  }
  return problems;
}

/** Posts that should have gone out but didn't. */
export async function checkStuckPublications(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const stuck = await db
    .select()
    .from(publications)
    .where(and(inArray(publications.status, ["scheduled", "publishing"]), lt(publications.scheduledAt, cutoff), eq(publications.manual, false)));
  for (const p of stuck) {
    await raiseAlert({ kind: "publish", source: p.platform, title: `Post stuck on ${p.platform}`, summary: `A ${p.platform} post scheduled for ${p.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC hasn't published (${p.lastError ?? "no error recorded"}).`, action: "Open the content item to retry or publish by hand.", importance: "high", url: `/content/${p.contentId}`, clientId: p.clientId, dedupeKey: `stuck:${p.id}` });
  }
  return stuck.length;
}

export async function checkCredits(): Promise<string | null> {
  if (!config().elevenlabs.apiKey) return null;
  try {
    const sub = await new ElevenLabsClient(config().elevenlabs.apiKey!).subscription();
    const db = await getDb();
    const upcoming = await db.select({ production: contentItems.production }).from(contentItems).where(inArray(contentItems.status, ["greenlit", "concept"]));
    const needed = upcoming.reduce((a, r) => a + [...(r.production?.voiceover?.script ?? "")].length, 0);
    const left = sub.limit - sub.used;
    if (left < needed) {
      await raiseAlert({ kind: "credits", source: "ElevenLabs", title: "ElevenLabs characters running low", summary: `${left.toLocaleString()} characters left this period; queued voiceovers need about ${needed.toLocaleString()}.`, action: "Top up or upgrade the ElevenLabs plan.", importance: "high", url: "https://elevenlabs.io/app/subscription", dedupeKey: `credits:el:${new Date().toISOString().slice(0, 10)}` });
    }
    return `ElevenLabs: ${left.toLocaleString()} characters left`;
  } catch (err) {
    log.warn("credits.check_failed", { error: errorMessage(err) });
    return null;
  }
}

/** Morning: change watch + health + credits, then one brief of what's waiting on the owner. */
export async function dailyWatch(): Promise<Record<string, unknown>> {
  const sources = await checkSources();
  const connectionProblems = await checkConnections();
  const stuck = await checkStuckPublications();
  const credits = await checkCredits();
  const db = await getDb();
  const [concepts, cuts, needsYou, high] = await Promise.all([
    db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.status, "concept")),
    db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.status, "review")),
    db.select({ id: inboxItems.id }).from(inboxItems).where(eq(inboxItems.status, "needs_you")),
    db.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.importance, "high"), eq(alerts.read, false))),
  ]);
  const summary = `${concepts.length} concepts to green-light, ${cuts.length} cuts to review, ${needsYou.length} messages need you, ${high.length} high alerts.`;
  if (concepts.length + cuts.length + needsYou.length + high.length > 0) {
    await notify({ title: "Morning brief", body: summary, url: "/", importance: "medium", tag: `brief:${new Date().toISOString().slice(0, 10)}` });
  }
  await logRun({ kind: "watch", summary: `Daily watch: ${sources.checked} sources (${sources.changed} changed, ${sources.filed} filed), ${connectionProblems} connection issues, ${stuck} stuck posts. ${credits ?? ""} ${summary}`.trim() });
  return { ...sources, connectionProblems, stuck };
}
