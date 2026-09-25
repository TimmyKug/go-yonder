import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  getCountryScanSnapshot,
  requestCountryScan,
  subscribeToCountryScan,
} from "@/src/countries/country-scanner";

const FIRST_SCAN_DELAY_MS = 1_500;

/**
 * Visited countries from the background scan. The scan saves its progress and
 * runs regardless of zoom; countries appear as soon as they are found.
 */
export function useCountrySummary(refreshToken?: number) {
  const snapshot = useSyncExternalStore(
    subscribeToCountryScan,
    getCountryScanSnapshot,
    getCountryScanSnapshot,
  );
  // Let the map settle first: the scan parses the bundled borders on first use.
  useFocusEffect(useCallback(() => {
    const timer = setTimeout(requestCountryScan, FIRST_SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, []));
  useEffect(() => {
    if (refreshToken !== undefined) requestCountryScan();
  }, [refreshToken]);
  return {
    countries: snapshot.countries,
    loading: snapshot.scanning,
    error: snapshot.error,
    refresh: requestCountryScan,
  };
}
