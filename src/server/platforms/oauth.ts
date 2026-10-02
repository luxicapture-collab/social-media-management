import { eq, lt } from "drizzle-orm";
import type { Platform } from "@/domain/types";
import { config, oauthRedirectUri } from "../config";
import { decrypt, encrypt, pkcePair, randomToken } from "../crypto";
import { getDb } from "../db/client";
import { oauthStates } from "../db/schema";
import { saveConnection } from "../services/connections";
import { formEncode, platformFetch, readJson } from "./http";
import { PlatformError } from "./types";

/**
 * OAuth connect flows. start → platform consent screen → callback exchanges the code, discovers
 * the accounts this login can manage (pages + linked Instagram accounts, LinkedIn organisations,
 * the X user) and parks them (encrypted) on the state row; the user then picks which account
 * belongs to the client.
 */

export type OAuthPlatform = "meta" | "linkedin" | "x";

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_read_user_content",
  "pages_messaging",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "instagram_manage_messages",
];

export interface DiscoveredAccount {
  key: string;
  label: string;
  /** Connections created when this option is chosen. */
  connections: Array<{
    platform: Platform;
    accountId: string;
    accountName?: string;
    handle?: string;
    token: string;
    refreshToken?: string;
    expiresAt?: string;
    scopes?: string[];
    meta?: Record<string, unknown>;
  }>;
}

export function isConfigured(platform: OAuthPlatform): boolean {
  const c = config();
  if (platform === "meta") return Boolean(c.meta.appId && c.meta.appSecret);
  if (platform === "linkedin") return Boolean(c.linkedin.clientId && c.linkedin.clientSecret);
  return Boolean(c.x.clientId);
}

export async function startOAuth(platform: OAuthPlatform, clientId: string): Promise<string> {
  if (!isConfigured(platform)) throw new PlatformError(`${platform} app credentials are not configured (see docs/SETUP.md)`, { retryable: false });
  const db = await getDb();
  const state = randomToken(24);
  const c = config();
  let url: string;
  let codeVerifier: string | null = null;
  if (platform === "meta") {
    const params = new URLSearchParams({ client_id: c.meta.appId!, redirect_uri: oauthRedirectUri("meta"), state, response_type: "code" });
    if (c.meta.loginConfigId) params.set("config_id", c.meta.loginConfigId);
    else params.set("scope", META_SCOPES.join(","));
    url = `https://www.facebook.com/${c.meta.graphVersion}/dialog/oauth?${params}`;
  } else if (platform === "linkedin") {
    const params = new URLSearchParams({ response_type: "code", client_id: c.linkedin.clientId!, redirect_uri: oauthRedirectUri("linkedin"), state, scope: c.linkedin.scopes.join(" ") });
    url = `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  } else {
    const { verifier, challenge } = pkcePair();
    codeVerifier = verifier;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: c.x.clientId!,
      redirect_uri: oauthRedirectUri("x"),
      scope: c.x.scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    url = `https://x.com/i/oauth2/authorize?${params}`;
  }
  await db.insert(oauthStates).values({ state, platform, clientId, codeVerifier });
  return url;
}

async function exchangeMeta(code: string): Promise<DiscoveredAccount[]> {
  const c = config();
  const base = `https://graph.facebook.com/${c.meta.graphVersion}`;
  const short = (await readJson(
    await platformFetch()(
      `${base}/oauth/access_token?${new URLSearchParams({ client_id: c.meta.appId!, client_secret: c.meta.appSecret!, redirect_uri: oauthRedirectUri("meta"), code })}`,
    ),
  )) as { access_token?: string; error?: { message: string } };
  if (!short.access_token) throw new PlatformError(`Meta login failed: ${short.error?.message ?? "no token"}`, { retryable: false });
  const long = (await readJson(
    await platformFetch()(
      `${base}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: c.meta.appId!, client_secret: c.meta.appSecret!, fb_exchange_token: short.access_token })}`,
    ),
  )) as { access_token?: string; expires_in?: number };
  const userToken = long.access_token ?? short.access_token;
  const pages = (await readJson(
    await platformFetch()(
      `${base}/me/accounts?${new URLSearchParams({
        fields: "id,name,access_token,instagram_business_account{id,username,name,followers_count}",
        limit: "100",
        access_token: userToken,
      })}`,
    ),
  )) as {
    data?: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string; name?: string; followers_count?: number } }>;
    error?: { message: string };
  };
  if (pages.error) throw new PlatformError(`Meta: could not list pages: ${pages.error.message}`, { retryable: false });
  return (pages.data ?? []).map((p) => {
    const ig = p.instagram_business_account;
    return {
      key: p.id,
      label: ig ? `${p.name} + Instagram @${ig.username ?? ig.id}` : `${p.name} (no Instagram linked)`,
      connections: [
        { platform: "facebook" as const, accountId: p.id, accountName: p.name, token: p.access_token, scopes: META_SCOPES },
        ...(ig
          ? [{ platform: "instagram" as const, accountId: ig.id, accountName: ig.name ?? ig.username, handle: ig.username, token: p.access_token, scopes: META_SCOPES, meta: { pageId: p.id, followers: ig.followers_count } }]
          : []),
      ],
    };
  });
}

async function exchangeLinkedIn(code: string): Promise<DiscoveredAccount[]> {
  const c = config();
  const res = await platformFetch()("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formEncode({ grant_type: "authorization_code", code, redirect_uri: oauthRedirectUri("linkedin"), client_id: c.linkedin.clientId, client_secret: c.linkedin.clientSecret }),
  });
  const tok = (await readJson(res)) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error_description?: string };
  if (!tok.access_token) throw new PlatformError(`LinkedIn login failed: ${tok.error_description ?? res.status}`, { retryable: false });
  const headers = { Authorization: `Bearer ${tok.access_token}`, "LinkedIn-Version": c.linkedin.apiVersion, "X-Restli-Protocol-Version": "2.0.0" };
  const expiresAt = new Date(Date.now() + (tok.expires_in ?? 5_184_000) * 1000).toISOString();
  const scopes = (tok.scope ?? "").split(/[ ,]+/).filter(Boolean);
  const accounts: DiscoveredAccount[] = [];

  const acls = (await readJson(await platformFetch()("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", { headers }))) as {
    elements?: Array<{ organization: string }>;
  };
  for (const el of acls.elements ?? []) {
    const id = el.organization.split(":").pop();
    const org = (await readJson(await platformFetch()(`https://api.linkedin.com/rest/organizations/${id}`, { headers }))) as { localizedName?: string; vanityName?: string };
    accounts.push({
      key: el.organization,
      label: `${org.localizedName ?? el.organization} (company page)`,
      connections: [{ platform: "linkedin", accountId: el.organization, accountName: org.localizedName, handle: org.vanityName, token: tok.access_token, refreshToken: tok.refresh_token, expiresAt, scopes }],
    });
  }
  const me = (await readJson(await platformFetch()("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }))) as { sub?: string; name?: string };
  if (me.sub) {
    accounts.push({
      key: `urn:li:person:${me.sub}`,
      label: `${me.name ?? "Personal profile"} (personal profile)`,
      connections: [{ platform: "linkedin", accountId: `urn:li:person:${me.sub}`, accountName: me.name, token: tok.access_token, refreshToken: tok.refresh_token, expiresAt, scopes }],
    });
  }
  return accounts;
}

async function exchangeX(code: string, verifier: string): Promise<DiscoveredAccount[]> {
  const c = config();
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (c.x.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${c.x.clientId}:${c.x.clientSecret}`).toString("base64")}`;
  const res = await platformFetch()("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: formEncode({ code, grant_type: "authorization_code", redirect_uri: oauthRedirectUri("x"), code_verifier: verifier, client_id: c.x.clientId }),
  });
  const tok = (await readJson(res)) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string };
  if (!tok.access_token) throw new PlatformError(`X login failed: ${tok.error_description ?? res.status}`, { retryable: false });
  const me = (await readJson(await platformFetch()("https://api.x.com/2/users/me?user.fields=public_metrics", { headers: { Authorization: `Bearer ${tok.access_token}` } }))) as {
    data?: { id: string; username: string; name: string };
  };
  if (!me.data) throw new PlatformError("X: could not read the account", { retryable: false });
  return [
    {
      key: me.data.id,
      label: `@${me.data.username}`,
      connections: [
        {
          platform: "x",
          accountId: me.data.id,
          accountName: me.data.name,
          handle: me.data.username,
          token: tok.access_token,
          refreshToken: tok.refresh_token,
          expiresAt: new Date(Date.now() + (tok.expires_in ?? 7200) * 1000).toISOString(),
          scopes: (tok.scope ?? "").split(" ").filter(Boolean),
        },
      ],
    },
  ];
}

/** Handle the provider callback; returns the state id and client so the UI can show the account picker. */
export async function completeOAuth(platform: OAuthPlatform, code: string, state: string): Promise<{ state: string; clientId: string; accounts: Array<{ key: string; label: string }> }> {
  const db = await getDb();
  const [row] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
  if (!row || row.platform !== platform) throw new PlatformError("Unknown or expired connect session; start again", { retryable: false });
  if (Date.now() - row.createdAt.getTime() > 20 * 60_000) throw new PlatformError("Connect session expired; start again", { retryable: false });
  const accounts =
    platform === "meta" ? await exchangeMeta(code) : platform === "linkedin" ? await exchangeLinkedIn(code) : await exchangeX(code, row.codeVerifier ?? "");
  await db.update(oauthStates).set({ payload: { sealed: encrypt(JSON.stringify(accounts)) } }).where(eq(oauthStates.state, state));
  return { state, clientId: row.clientId, accounts: accounts.map((a) => ({ key: a.key, label: a.label })) };
}

export async function pendingAccounts(state: string): Promise<{ clientId: string; platform: string; accounts: DiscoveredAccount[] } | null> {
  const db = await getDb();
  const [row] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
  const sealed = (row?.payload as { sealed?: string } | undefined)?.sealed;
  if (!row || !sealed) return null;
  return { clientId: row.clientId, platform: row.platform, accounts: JSON.parse(decrypt(sealed)) as DiscoveredAccount[] };
}

/** Save the chosen account(s) as connections for the client. */
export async function finishOAuth(state: string, key: string): Promise<{ clientId: string; saved: Platform[] }> {
  const pending = await pendingAccounts(state);
  if (!pending) throw new PlatformError("Connect session not found", { retryable: false });
  const choice = pending.accounts.find((a) => a.key === key);
  if (!choice) throw new PlatformError("That account isn't part of this login", { retryable: false });
  const saved: Platform[] = [];
  for (const c of choice.connections) {
    await saveConnection({
      clientId: pending.clientId,
      platform: c.platform,
      accountId: c.accountId,
      accountName: c.accountName,
      handle: c.handle,
      accessToken: c.token,
      refreshToken: c.refreshToken,
      tokenExpiresAt: c.expiresAt ? new Date(c.expiresAt) : null,
      scopes: c.scopes,
      meta: c.meta,
    });
    saved.push(c.platform);
  }
  const db = await getDb();
  await db.delete(oauthStates).where(eq(oauthStates.state, state));
  return { clientId: pending.clientId, saved };
}

export async function pruneOAuthStates(): Promise<void> {
  const db = await getDb();
  await db.delete(oauthStates).where(lt(oauthStates.createdAt, new Date(Date.now() - 60 * 60_000)));
}
