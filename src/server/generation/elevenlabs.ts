/**
 * ElevenLabs REST client (paths and fields match the official @elevenlabs/elevenlabs-js SDK):
 *  - POST /v1/text-to-speech/{voice_id}/with-timestamps   (query: output_format)
 *  - POST /v1/music                                       (prompt, music_length_ms, force_instrumental, model_id)
 *  - POST /v1/sound-generation                            (text, duration_seconds, prompt_influence)
 *  - GET  /v2/voices?search=...                           voice library
 *  - GET  /v1/user/subscription                           character usage
 * eleven_v3 is the only ElevenLabs TTS model that speaks Persian, so it is the default.
 */

import { GenerationError } from "./higgsfield";

export interface Alignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export interface Voice {
  voiceId: string;
  name: string;
  labels: Record<string, string>;
  category?: string;
  previewUrl?: string;
}

export class ElevenLabsClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.elevenlabs.io",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(json = true): Record<string, string> {
    return { "xi-api-key": this.apiKey, ...(json ? { "Content-Type": "application/json" } : {}) };
  }

  private async fail(res: Response, context: string): Promise<never> {
    const text = (await res.text()).slice(0, 400);
    const retryable = res.status === 429 || res.status >= 500;
    if (res.status === 401) throw new GenerationError(`ElevenLabs: invalid API key (${context})`, false, 401);
    if (res.status === 402 || /quota|credits/i.test(text)) throw new GenerationError(`ElevenLabs: out of credits (${context}): ${text}`, false, res.status);
    throw new GenerationError(`ElevenLabs ${res.status} (${context}): ${text}`, retryable, res.status);
  }

  async tts(input: {
    voiceId: string;
    text: string;
    modelId?: string;
    languageCode?: string;
    outputFormat?: string;
  }): Promise<{ audio: Buffer; alignment?: Alignment }> {
    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps?output_format=${encodeURIComponent(input.outputFormat ?? "mp3_44100_128")}`;
    const body: Record<string, unknown> = { text: input.text, model_id: input.modelId ?? "eleven_v3" };
    if (input.languageCode) body.language_code = input.languageCode;
    const res = await this.fetchImpl(url, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok) await this.fail(res, "text-to-speech");
    const json = (await res.json()) as {
      audio_base64: string;
      alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null;
      normalized_alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null;
    };
    const a = json.alignment ?? json.normalized_alignment ?? null;
    return {
      audio: Buffer.from(json.audio_base64, "base64"),
      alignment: a ? { characters: a.characters, starts: a.character_start_times_seconds, ends: a.character_end_times_seconds } : undefined,
    };
  }

  async music(input: { prompt: string; lengthMs: number; instrumental?: boolean; modelId?: string }): Promise<Buffer> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/music?output_format=mp3_44100_128`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        prompt: input.prompt,
        music_length_ms: Math.max(3000, Math.min(600000, Math.round(input.lengthMs))),
        force_instrumental: input.instrumental ?? true,
        ...(input.modelId ? { model_id: input.modelId } : {}),
      }),
    });
    if (!res.ok) await this.fail(res, "music");
    return Buffer.from(await res.arrayBuffer());
  }

  async soundEffect(input: { text: string; durationSeconds?: number; promptInfluence?: number }): Promise<Buffer> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/sound-generation?output_format=mp3_44100_128`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        text: input.text,
        ...(input.durationSeconds ? { duration_seconds: Math.max(0.5, Math.min(30, input.durationSeconds)) } : {}),
        prompt_influence: input.promptInfluence ?? 0.4,
      }),
    });
    if (!res.ok) await this.fail(res, "sound-generation");
    return Buffer.from(await res.arrayBuffer());
  }

  async voices(search?: string): Promise<Voice[]> {
    const qs = new URLSearchParams({ page_size: "100", ...(search ? { search } : {}) });
    const res = await this.fetchImpl(`${this.baseUrl}/v2/voices?${qs}`, { headers: this.headers(false) });
    if (!res.ok) await this.fail(res, "voices");
    const json = (await res.json()) as { voices: Array<{ voice_id: string; name: string; labels?: Record<string, string>; category?: string; preview_url?: string }> };
    return json.voices.map((v) => ({ voiceId: v.voice_id, name: v.name, labels: v.labels ?? {}, category: v.category, previewUrl: v.preview_url }));
  }

  async subscription(): Promise<{ used: number; limit: number; resetsAt?: Date; tier?: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/user/subscription`, { headers: this.headers(false) });
    if (!res.ok) await this.fail(res, "subscription");
    const json = (await res.json()) as { character_count: number; character_limit: number; next_character_count_reset_unix?: number; tier?: string };
    return {
      used: json.character_count,
      limit: json.character_limit,
      resetsAt: json.next_character_count_reset_unix ? new Date(json.next_character_count_reset_unix * 1000) : undefined,
      tier: json.tier,
    };
  }
}

/** Pick a voice that matches a casting note ("warm, intimate, female, 30s"). */
export function pickVoice(voices: Voice[], voiceStyle: string, preferredId?: string): Voice | undefined {
  if (preferredId) {
    const exact = voices.find((v) => v.voiceId === preferredId);
    if (exact) return exact;
  }
  const wanted = voiceStyle.toLowerCase();
  const score = (v: Voice) => {
    const hay = `${v.name} ${Object.values(v.labels).join(" ")}`.toLowerCase();
    let s = 0;
    for (const token of wanted.split(/[\s,;/]+/).filter((t) => t.length > 2)) if (hay.includes(token)) s += 2;
    if (/female|woman/.test(wanted) && /female|woman/.test(hay)) s += 3;
    if (/\bmale\b|\bman\b/.test(wanted) && /\bmale\b/.test(hay) && !/female/.test(hay)) s += 3;
    if (/narrat|story|documentary/.test(hay)) s += 1;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}
