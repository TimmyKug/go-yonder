import { AppState } from "react-native";

import { scanCountries } from "./country-scan";

import { getCountries } from "@/src/data/countries";
import { getCountryCache } from "@/src/data/country-cache-database";
import {
  countryBoundariesFingerprint,
  readCachedCountrySummary,
} from "@/src/data/country-cache-repository";
import { getDatabase } from "@/src/data/database";
import { CountryIndex, type CountryProperties, type CountryVisit } from "@/src/domain/country-coverage";


// Work in short slices so the map stays responsive, and publish results at
// most a few times a second.
const SLICE_MS = 8;
const PUBLISH_INTERVAL_MS = 400;

export type CountryScanSnapshot = Readonly<{
  countries?: readonly CountryVisit[];
  scanning: boolean;
  error?: string;
}>;

let snapshot: CountryScanSnapshot = { scanning: false };
const listeners = new Set<() => void>();
let running = false;
let rerun = false;
let lastPublishMs = 0;
let index: { countries: Map<string, CountryProperties>; index: CountryIndex; boundaries: string } | undefined;

function setSnapshot(next: Partial<CountryScanSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function getIndex() {
  if (!index) {
    const collection = getCountries();
    index = {
      countries: new Map(collection.features.map(({ properties }) => [properties.id, properties])),
      index: new CountryIndex(collection),
      boundaries: countryBoundariesFingerprint(collection),
    };
  }
  return index;
}

async function publish() {
  lastPublishMs = Date.now();
  const countries = await readCachedCountrySummary(await getCountryCache(), getIndex().countries);
  setSnapshot({ countries });
}

async function run() {
  running = true;
  setSnapshot({ scanning: true, error: undefined });
  try {
    const { index: countryIndex, boundaries } = getIndex();
    await publish();
    let sliceStartMs = Date.now();
    await scanCountries(await getDatabase(), await getCountryCache(), countryIndex, boundaries, {
      shouldContinue: () => AppState.currentState !== "background" && !rerun,
      pause: async () => {
        if (Date.now() - sliceStartMs < SLICE_MS) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        sliceStartMs = Date.now();
      },
      onProgress: () => {
        if (Date.now() - lastPublishMs >= PUBLISH_INTERVAL_MS) void publish().catch(() => undefined);
      },
    });
    await publish();
  } catch {
    setSnapshot({ error: "Your countries could not be loaded." });
  } finally {
    running = false;
    setSnapshot({ scanning: false });
    if (rerun) {
      rerun = false;
      void run();
    }
  }
}

/**
 * Starts or continues the background country scan. Cheap to call often: new
 * cells since the last scan are all it has to process.
 */
export function requestCountryScan(): void {
  if (running) {
    rerun = true;
    return;
  }
  void run();
}

export function getCountryScanSnapshot(): CountryScanSnapshot {
  return snapshot;
}

export function subscribeToCountryScan(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

AppState.addEventListener("change", (state) => {
  if (state === "active") requestCountryScan();
});
