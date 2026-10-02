import { PlatformError } from "./types";

export type FetchLike = typeof fetch;

let fetchImpl: FetchLike = (...args) => fetch(...args);

/** Adapters call platform APIs through this so tests can substitute a fake. */
export function platformFetch(): FetchLike {
  return fetchImpl;
}

export function setPlatformFetchForTests(f: FetchLike | undefined): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formEncode(params: Record<string, string | number | boolean | undefined | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p;
}

export function httpError(platform: string, status: number, message: string): PlatformError {
  return new PlatformError(`${platform} ${status}: ${message}`, {
    retryable: status === 429 || status >= 500,
    authExpired: status === 401,
    permission: status === 403,
    status,
  });
}
