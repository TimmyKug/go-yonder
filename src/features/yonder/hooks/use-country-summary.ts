import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { readCountrySummary } from "@/src/data/country-summary";
import { getDatabase } from "@/src/data/database";
import type { CountryVisit } from "@/src/domain/country-coverage";

let lastSummary: CountryVisit[] | undefined;

export function useCountrySummary(enabled: boolean, refreshToken?: number) {
  const [countries, setCountries] = useState(lastSummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const reload = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => reload.current(), []);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (cancelled) return;
      // Frequent GPS updates queue a refresh rather than cancelling an initial
      // scan before it can complete for a large imported history.
      if (running) { queued = true; return; }
      running = true;
      queued = false;
      setLoading(true);
      setError(undefined);
      try {
        const result = await readCountrySummary(await getDatabase(), undefined, () => cancelled);
        if (!cancelled && result) {
          lastSummary = result;
          setCountries(result);
        }
      } catch {
        if (!cancelled) setError("Your countries could not be loaded.");
      } finally {
        running = false;
        if (!cancelled) {
          setLoading(false);
          if (queued) timer = setTimeout(() => void load(), 0);
        }
      }
    };
    reload.current = () => { void load(); };
    timer = setTimeout(() => void load(), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      reload.current = () => undefined;
    };
  }, [enabled]);
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refreshToken, refresh]);
  return { countries, loading, error, refresh };
}
