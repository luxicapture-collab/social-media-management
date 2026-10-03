import { and, eq } from "drizzle-orm";
import type { Platform } from "@/domain/types";
import { raiseAlert } from "../activity";
import { config } from "../config";
import { decryptOptional, encrypt, encryptOptional, newId } from "../crypto";
import { getDb } from "../db/client";
import { connections, type ConnectionRow } from "../db/schema";
import { formEncode, platformFetch, readJson } from "../platforms/http";
import { PlatformError, type ConnectionCtx } from "../platforms/types";

export function toCtx(row: ConnectionRow): ConnectionCtx {
  return {
    id: row.id,
    clientId: row.clientId,
    platform: row.platform,
    accountId: row.accountId,
    accountName: row.accountName,
    handle: row.handle,
    accessToken: decryptOptional(row.accessTokenEnc) ?? "",
    refreshToken: decryptOptional(row.refreshTokenEnc),
    tokenExpiresAt: row.tokenExpiresAt,
    meta: row.meta ?? {},
    mode: row.mode,
  };
}

export async function listConnections(clientId: string): Promise<ConnectionRow[]> {
  const db = await getDb();
  return db.select().from(connections).where(eq(connections.clientId, clientId));
}

export async function getConnection(clientId: string, platform: Platform | "metricool"): Promise<ConnectionRow | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.clientId, clientId), eq(connections.platform, platform)));
  return row;
}

export interface SaveConnectionInput {
  clientId: string;
  platform: Platform | "metricool";
  accountId: string;
  accountName?: string | null;
  handle?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: string[];
  meta?: Record<string, unknown>;
  mode?: "live" | "demo";
  route?: "direct" | "metricool";
}

export async function saveConnection(input: SaveConnectionInput): Promise<string> {
  const db = await getDb();
  const id = newId("con");
  const values = {
    id,
    clientId: input.clientId,
    platform: input.platform,
    accountId: input.accountId,
    accountName: input.accountName ?? null,
    handle: input.handle ?? null,
    accessTokenEnc: encrypt(input.accessToken),
    refreshTokenEnc: encryptOptional(input.refreshToken),
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    scopes: input.scopes ?? [],
    meta: input.meta ?? {},
    mode: input.mode ?? "live",
    route: input.route ?? "direct",
    status: "connected" as const,
    lastError: null,
    lastCheckedAt: new Date(),
  };
  const { id: _newId, ...updatable } = values;
  const [row] = await db
    .insert(connections)
    .values(values)
    .onConflictDoUpdate({
      target: [connections.clientId, connections.platform],
      set: { ...updatable, updatedAt: new Date() },
    })
    .returning({ id: connections.id });
  return row.id;
}

export async function setConnectionRoute(clientId: string, platform: Platform, route: "direct" | "metricool"): Promise<void> {
  const db = await getDb();
  await db.update(connections).set({ route, updatedAt: new Date() }).where(and(eq(connections.clientId, clientId), eq(connections.platform, platform)));
}

export async function deleteConnection(clientId: string, platform: Platform | "metricool"): Promise<void> {
  const db = await getDb();
  await db.delete(connections).where(and(eq(connections.clientId, clientId), eq(connections.platform, platform)));
}

/** Refresh OAuth 2.0 tokens that expire soon (X: 2 h tokens; LinkedIn: 60 days). */
export async function freshCtx(row: ConnectionRow): Promise<ConnectionCtx> {
  const ctx = toCtx(row);
  if (ctx.mode === "demo" || !ctx.refreshToken || !ctx.tokenExpiresAt) return ctx;
  const soon = ctx.platform === "x" ? 5 * 60_000 : 7 * 86_400_000;
  if (ctx.tokenExpiresAt.getTime() - Date.now() > soon) return ctx;
  const refreshed = ctx.platform === "x" ? await refreshX(ctx.refreshToken) : ctx.platform === "linkedin" ? await refreshLinkedIn(ctx.refreshToken) : null;
  if (!refreshed) return ctx;
  const db = await getDb();
  await db
    .update(connections)
    .set({
      accessTokenEnc: encrypt(refreshed.accessToken),
      refreshTokenEnc: encryptOptional(refreshed.refreshToken ?? ctx.refreshToken),
      tokenExpiresAt: refreshed.expiresAt,
      status: "connected",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, row.id));
  return { ...ctx, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken ?? ctx.refreshToken, tokenExpiresAt: refreshed.expiresAt };
}

interface Refreshed {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

async function refreshX(refreshToken: string): Promise<Refreshed> {
  const { clientId, clientSecret } = config().x;
  if (!clientId) throw new PlatformError("X_CLIENT_ID is not configured", { retryable: false });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const res = await platformFetch()("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: formEncode({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  const data = (await readJson(res)) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new PlatformError(`X token refresh failed: ${data.error_description ?? res.status}`, { retryable: false, authExpired: true });
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000) };
}

async function refreshLinkedIn(refreshToken: string): Promise<Refreshed> {
  const { clientId, clientSecret } = config().linkedin;
  if (!clientId || !clientSecret) throw new PlatformError("LinkedIn client credentials are not configured", { retryable: false });
  const res = await platformFetch()("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formEncode({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  const data = (await readJson(res)) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new PlatformError(`LinkedIn token refresh failed: ${data.error_description ?? res.status}`, { retryable: false, authExpired: true });
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000) };
}

/** Record a platform failure on the connection; expired auth raises a high alert once. */
export async function recordConnectionFailure(row: ConnectionRow, err: unknown): Promise<void> {
  const db = await getDb();
  const message = err instanceof Error ? err.message : String(err);
  const expired = err instanceof PlatformError && err.opts.authExpired;
  await db
    .update(connections)
    .set({ status: expired ? "expired" : "error", lastError: message.slice(0, 1000), lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(connections.id, row.id));
  if (expired) {
    await raiseAlert({
      kind: "health",
      source: row.platform,
      title: `${row.platform} connection expired for ${row.accountName ?? row.accountId}`,
      summary: "The access token is no longer valid, so publishing, analytics and replies are paused for this account. Reconnect it to resume.",
      action: "Open the client and press Reconnect.",
      importance: "high",
      url: `/clients/${row.clientId}`,
      clientId: row.clientId,
      dedupeKey: `expired:${row.id}:${new Date().toISOString().slice(0, 10)}`,
    });
  }
}

export async function markConnectionHealthy(row: ConnectionRow): Promise<void> {
  const db = await getDb();
  await db.update(connections).set({ status: "connected", lastError: null, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, row.id));
}

/** Demo connections let the whole flow run without real accounts. */
export async function connectDemoAccounts(clientId: string, platforms: Platform[], followers = 4200): Promise<void> {
  for (const p of platforms) {
    await saveConnection({
      clientId,
      platform: p,
      accountId: `demo-${p}-${clientId}`,
      accountName: `Demo ${p}`,
      handle: `demo_${clientId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`,
      accessToken: "demo",
      mode: "demo",
      meta: { followers: p === "linkedin" ? Math.round(followers * 0.4) : p === "x" ? Math.round(followers * 0.3) : followers, anchorDay: Math.floor(Date.now() / 86_400_000) },
    });
  }
}
