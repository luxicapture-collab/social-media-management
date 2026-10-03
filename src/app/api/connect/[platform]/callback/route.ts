import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { getDb } from "@/server/db/client";
import { oauthStates } from "@/server/db/schema";
import { errorMessage, log } from "@/server/log";
import { completeOAuth, finishOAuth, type OAuthPlatform } from "@/server/platforms/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS: OAuthPlatform[] = ["meta", "linkedin", "x"];

/** Provider redirect target. One discovered account is saved directly; several go to a picker. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const appUrl = config().appUrl;
  if (!(await currentUser())) return NextResponse.redirect(new URL("/login", appUrl));
  const { platform } = await params;
  if (!PLATFORMS.includes(platform as OAuthPlatform)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const state = sp.get("state") ?? "";
  const code = sp.get("code");
  const denied = sp.get("error_description") ?? sp.get("error");

  const db = await getDb();
  const [row] = state ? await db.select({ clientId: oauthStates.clientId }).from(oauthStates).where(eq(oauthStates.state, state)) : [];
  const back = (q: string) => NextResponse.redirect(new URL(row ? `/clients/${row.clientId}?${q}` : `/clients?${q}`, appUrl));
  if (denied || !code || !row) return back(`error=${encodeURIComponent(denied ?? "The connection was canceled or expired. Try again.")}`);

  try {
    const result = await completeOAuth(platform as OAuthPlatform, code, state);
    if (result.accounts.length === 1) {
      await finishOAuth(state, result.accounts[0].key);
      return back("connected=1");
    }
    return NextResponse.redirect(new URL(`/clients/${result.clientId}/connect?state=${encodeURIComponent(state)}`, appUrl));
  } catch (err) {
    log.warn("oauth.callback_failed", { platform, error: errorMessage(err) });
    return back(`error=${encodeURIComponent(errorMessage(err))}`);
  }
}
