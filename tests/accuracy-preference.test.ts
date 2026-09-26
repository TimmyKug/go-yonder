import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
  },
}));

describe("accuracy preference", () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
  });

  it("defaults to 100 m and ignores values that are not offered", async () => {
    const { parseAccuracyPreference, readMaxLiveAccuracyM } = await import(
      "@/src/data/accuracy-preference"
    );

    expect(readMaxLiveAccuracyM()).toBe(100);
    expect(parseAccuracyPreference("50")).toBe(50);
    expect(parseAccuracyPreference("75")).toBe(100);
    expect(parseAccuracyPreference("garbage")).toBe(100);
    expect(parseAccuracyPreference(null)).toBe(100);
  });

  it("persists a choice and notifies subscribers", async () => {
    const { readMaxLiveAccuracyM, subscribeMaxLiveAccuracyM, writeMaxLiveAccuracyM } =
      await import("@/src/data/accuracy-preference");
    const listener = vi.fn();
    const unsubscribe = subscribeMaxLiveAccuracyM(listener);

    await writeMaxLiveAccuracyM(25);

    expect(readMaxLiveAccuracyM()).toBe(25);
    expect(store.get("max-live-accuracy-m")).toBe("25");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();

    vi.resetModules();
    const reloaded = await import("@/src/data/accuracy-preference");
    expect(reloaded.readMaxLiveAccuracyM()).toBe(25);
  });
});
