import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "luxi_session";
const MAX_AGE_SECONDS = 30 * 24 * 3600;

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface Session {
  email: string;
}

export async function signSession(email: string, secret: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .setIssuer("luxi-social-agent")
    .sign(secretKey(secret));
}

export async function verifySession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ["HS256"], issuer: "luxi-social-agent" });
    return typeof payload.email === "string" ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECONDS,
});

/**
 * Where to go after signing in: only same-origin paths. Rejects protocol-relative tricks such as
 * "//evil.com" and "/\evil.com" (browsers treat a backslash like a slash) and control characters.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const base = "http://local.invalid";
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
