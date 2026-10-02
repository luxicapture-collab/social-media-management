import { DEFAULT_MODELS, type ModelEntry } from "@/domain/models";
import { getSetting, setSetting } from "../settings";

/** Model registry: defaults merged with entries edited in Settings → Models (matched by key). */
export async function getModels(): Promise<ModelEntry[]> {
  const stored = await getSetting<ModelEntry[] | null>("models", null);
  if (!stored || !Array.isArray(stored)) return DEFAULT_MODELS;
  const byKey = new Map(DEFAULT_MODELS.map((m) => [m.key, m]));
  for (const m of stored) byKey.set(m.key, { ...(byKey.get(m.key) ?? {}), ...m } as ModelEntry);
  return [...byKey.values()];
}

export async function saveModels(models: ModelEntry[]): Promise<void> {
  await setSetting("models", models);
}
