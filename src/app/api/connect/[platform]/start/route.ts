import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { errorMessage } from "@/server/log";
import { startOAuth, type OAuthPlatform } from "@/server/platforms/oauth";
import { getClient } from "@/server/services/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS: OAuthPlatform[] = ["meta", "linkedin", "x"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const appUrl = config().appUrl;
  if (!(await currentUser())) return NextResponse.redirect(new URL("/login", appUrl));
  const { platform } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  if (!PLATFORMS.includes(platform as OAuthPlatform)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  if (!clientId || !(await getClient(clientId))) return NextResponse.redirect(new URL("/clients", appUrl));
  try {
    return NextResponse.redirect(await startOAuth(platform as OAuthPlatform, clientId));
  } catch (err) {
    return NextResponse.redirect(new URL(`/clients/${clientId}?error=${encodeURIComponent(errorMessage(err))}`, appUrl));
  }
}
