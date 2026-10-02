import crypto from "node:crypto";
import { config } from "./config";

/**
 * Secrets at rest (OAuth tokens) are encrypted with AES-256-GCM. The key is derived from
 * ENCRYPTION_KEY with scrypt so any sufficiently long passphrase works.
 */

let derived: { source: string; key: Buffer } | undefined;

function key(): Buffer {
  const source = config().encryptionKey;
  if (!derived || derived.source !== source) {
    derived = { source, key: crypto.scryptSync(source, "luxi-social-agent/v1", 32) };
  }
  return derived.key;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decrypt(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || dataB64 === undefined) throw new Error("Unrecognised encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptOptional(plain: string | null | undefined): string | null {
  return plain ? encrypt(plain) : null;
}

export function decryptOptional(payload: string | null | undefined): string | null {
  return payload ? decrypt(payload) : null;
}

export function newId(prefix?: string): string {
  const raw = crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 14).toLowerCase();
  return prefix ? `${prefix}_${raw}` : raw;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, body: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Meta webhooks: X-Hub-Signature-256: sha256=<hex HMAC of raw body with the app secret>. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), hmacSha256Hex(appSecret, rawBody));
}

/** PKCE (RFC 7636) verifier/challenge pair for OAuth 2.0 public flows (X). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Password hashes: scrypt$N$r$p$saltB64$hashB64. Generate with `npx tsx scripts/hash-password.ts`. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = crypto.scryptSync(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}
