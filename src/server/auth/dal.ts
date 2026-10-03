import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "../config";
import { safeEqual, verifyPassword } from "../crypto";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession, type Session } from "./session";

/** Data-access-layer guard: every page, action and route handler that touches data calls this. */
export async function requireUser(): Promise<Session> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, config().sessionSecret);
  if (!session) redirect("/login");
  return session;
}

export async function currentUser(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token, config().sessionSecret);
}

const attempts = new Map<string, { count: number; until: number }>();

/** Check the owner credentials (env) with a small lockout against guessing. */
export function checkCredentials(email: string, password: string, ip = "local"): { ok: boolean; error?: string } {
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.count >= 8 && a.until > now) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  const { admin } = config();
  const emailOk = safeEqual(email.trim().toLowerCase(), admin.email);
  let passOk = false;
  if (admin.passwordHash) passOk = verifyPassword(password, admin.passwordHash);
  else if (admin.password) passOk = safeEqual(password, admin.password);
  if (emailOk && passOk) {
    attempts.delete(ip);
    return { ok: true };
  }
  attempts.set(ip, { count: (a?.count ?? 0) + 1, until: now + 10 * 60_000 });
  if (!admin.password && !admin.passwordHash) return { ok: false, error: "No ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is configured on the server." };
  return { ok: false, error: "Email or password is incorrect." };
}

export async function startSession(email: string): Promise<void> {
  const token = await signSession(email.toLowerCase(), config().sessionSecret);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(config().appUrl.startsWith("https://")));
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
