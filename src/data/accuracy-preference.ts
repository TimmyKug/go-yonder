import Storage from "expo-sqlite/kv-store";

import {
  DEFAULT_MAX_LIVE_HORIZONTAL_ACCURACY_M,
  LIVE_ACCURACY_OPTIONS_M,
  type LiveAccuracyOptionM,
} from "@/src/config/yonder-config";

const ACCURACY_KEY = "max-live-accuracy-m";

const listeners = new Set<() => void>();
let cached: LiveAccuracyOptionM | undefined;

export function parseAccuracyPreference(value: string | null): LiveAccuracyOptionM {
  const parsed = Number(value);
  return LIVE_ACCURACY_OPTIONS_M.find((option) => option === parsed) ??
    DEFAULT_MAX_LIVE_HORIZONTAL_ACCURACY_M;
}

/** The accuracy a live reading needs to unlock a tile. Readable from background tasks. */
export function readMaxLiveAccuracyM(): LiveAccuracyOptionM {
  if (cached !== undefined) return cached;
  try {
    cached = parseAccuracyPreference(Storage.getItemSync(ACCURACY_KEY));
  } catch {
    return DEFAULT_MAX_LIVE_HORIZONTAL_ACCURACY_M;
  }
  return cached;
}

export async function writeMaxLiveAccuracyM(value: LiveAccuracyOptionM): Promise<void> {
  await Storage.setItemAsync(ACCURACY_KEY, String(value));
  cached = value;
  listeners.forEach((listener) => listener());
}

export function subscribeMaxLiveAccuracyM(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
