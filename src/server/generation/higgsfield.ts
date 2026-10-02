/**
 * Higgsfield API client (https://api.higgsfield.ai), matching the official @higgsfield/client v2:
 *  - auth header:  Authorization: Key KEY_ID:KEY_SECRET
 *  - submit:       POST /{model-endpoint}  body = model input  (optional ?hf_webhook=URL)
 *  - poll:         GET  /requests/{request_id}/status
 *  - cancel:       POST /requests/{request_id}/cancel
 * Terminal statuses: completed (images[]/video URLs), failed, nsfw (both refunded), canceled.
 */

export type HiggsfieldStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface HiggsfieldResult {
  requestId: string;
  status: HiggsfieldStatus;
  imageUrls: string[];
  videoUrl?: string;
  raw: unknown;
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export class HiggsfieldClient {
  constructor(
    private readonly credentials: string,
    private readonly baseUrl = "https://api.higgsfield.ai",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!credentials.includes(":")) throw new Error('HIGGSFIELD_CREDENTIALS must be "KEY_ID:KEY_SECRET"');
  }

  private headers(): Record<string, string> {
    return { Authorization: `Key ${this.credentials}`, "Content-Type": "application/json", Accept: "application/json" };
  }

  private async handle(res: Response, context: string): Promise<unknown> {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // keep text
    }
    if (res.ok) return body;
    const detail = typeof body === "object" && body && "detail" in body ? JSON.stringify((body as { detail: unknown }).detail) : String(text).slice(0, 400);
    if (res.status === 401) throw new GenerationError(`Higgsfield: invalid API credentials (${context})`, false, 401);
    if (res.status === 402 || res.status === 403) throw new GenerationError(`Higgsfield: not enough credits or access denied (${context}): ${detail}`, false, res.status);
    if (res.status === 400 || res.status === 422) throw new GenerationError(`Higgsfield rejected the input for ${context}: ${detail}`, false, res.status);
    if (res.status === 404) throw new GenerationError(`Higgsfield endpoint not found (${context}) — check the model registry`, false, 404);
    throw new GenerationError(`Higgsfield error ${res.status} (${context}): ${detail}`, res.status === 429 || res.status >= 500, res.status);
  }

  private parse(body: unknown): HiggsfieldResult {
    const b = body as {
      request_id?: string;
      id?: string;
      status?: string;
      images?: Array<{ url: string }>;
      video?: { url: string };
      jobs?: Array<{ status?: string; results?: { raw?: { url: string } } }>;
    };
    const requestId = b.request_id ?? b.id ?? "";
    const status = (b.status ?? b.jobs?.[0]?.status ?? "queued") as HiggsfieldStatus;
    const imageUrls = (b.images ?? []).map((i) => i.url).filter(Boolean);
    let videoUrl = b.video?.url;
    // Older job-set shape: jobs[].results.raw.url
    if (!videoUrl && !imageUrls.length && b.jobs?.length) {
      for (const j of b.jobs) {
        const url = j.results?.raw?.url;
        if (url && /\.(mp4|mov|webm)(\?|$)/i.test(url)) videoUrl = url;
        else if (url) imageUrls.push(url);
      }
    }
    return { requestId, status, imageUrls, videoUrl, raw: body };
  }

  async submit(endpoint: string, input: Record<string, unknown>, webhookUrl?: string): Promise<HiggsfieldResult> {
    let path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    if (webhookUrl) path += `${path.includes("?") ? "&" : "?"}hf_webhook=${encodeURIComponent(webhookUrl)}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method: "POST", headers: this.headers(), body: JSON.stringify(input) });
    const parsed = this.parse(await this.handle(res, endpoint));
    if (!parsed.requestId) throw new GenerationError(`Higgsfield returned no request_id for ${endpoint}`, true);
    return parsed;
  }

  async status(requestId: string): Promise<HiggsfieldResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/requests/${encodeURIComponent(requestId)}/status`, { headers: this.headers() });
    const parsed = this.parse(await this.handle(res, `status ${requestId}`));
    return { ...parsed, requestId: parsed.requestId || requestId };
  }

  async cancel(requestId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", headers: this.headers() });
    if (!res.ok && res.status !== 409) await this.handle(res, `cancel ${requestId}`);
  }
}

export function isTerminal(status: HiggsfieldStatus): boolean {
  return status === "completed" || status === "failed" || status === "nsfw" || status === "canceled";
}
