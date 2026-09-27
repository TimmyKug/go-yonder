import { AppState } from "react-native";

import { scanCountries } from "./country-scan";

import { getCountries } from "@/src/data/countries";
import { getCountryCache } from "@/src/data/country-cache-database";
import {
  countryBoundariesFingerprint,
  readCachedCountrySummary,
  readCachedRegionSummary,
} from "@/src/data/country-cache-repository";
import { getDatabase } from "@/src/data/database";
import { getRegions } from "@/src/data/regions";
import {
  AreaIndex,
  CountryIndex,
  type CountryProperties,
  type CountryVisit,
  type RegionProperties,
  type RegionVisit,
} from "@/src/domain/country-coverage";


// Work in short slices so the map stays responsive, and publish results at
// most a few times a second.
const SLICE_MS = 8;
const PUBLISH_INTERVAL_MS = 400;

export type CountryScanSnapshot = Readonly<{
  countries?: readonly CountryVisit[];
  /** Visited regions, grouped by country ID. */
  regions?: ReadonlyMap<string, readonly RegionVisit[]>;
  scanning: boolean;
  error?: string;
}>;

let snapshot: CountryScanSnapshot = { scanning: false };
const listeners = new Set<() => void>();
let running = false;
let rerun = false;
let lastPublishMs = 0;
let index: {
  countries: Map<string, CountryProperties>;
  index: CountryIndex;
  regions: Map<string, RegionProperties>;
  regionIndex: AreaIndex<RegionProperties>;
  /** How many regions each country has, for "3 of 16 regions". */
  regionCounts: Map<string, number>;
  boundaries: string;
} | undefined;

function setSnapshot(next: Partial<CountryScanSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function getIndex() {
  if (!index) {
    const collection = getCountries();
    const regions = getRegions();
    const regionCounts = new Map<string, number>();
    for (const { properties } of regions.features) {
      regionCounts.set(properties.countryId, (regionCounts.get(properties.countryId) ?? 0) + 1);
    }
    index = {
      countries: new Map(collection.features.map(({ properties }) => [properties.id, properties])),
      index: new CountryIndex(collection),
      regions: new Map(regions.features.map(({ properties }) => [properties.id, properties])),
      regionIndex: new AreaIndex(regions),
      regionCounts,
      boundaries: countryBoundariesFingerprint(collection, regions),
    };
  }
  return index;
}

async function publish() {
  lastPublishMs = Date.now();
  const cache = await getCountryCache();
  const { countries: countryMap, regions: regionMap } = getIndex();
  const countries = await readCachedCountrySummary(cache, countryMap);
  const regions = new Map<string, RegionVisit[]>();
  for (const region of await readCachedRegionSummary(cache, regionMap)) {
    const list = regions.get(region.countryId);
    if (list) list.push(region);
    else regions.set(region.countryId, [region]);
  }
  setSnapshot({ countries, regions });
}

async function run() {
  running = true;
  setSnapshot({ scanning: true, error: undefined });
  try {
    const { index: countryIndex, regionIndex, boundaries } = getIndex();
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
    }, regionIndex);
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

/** How many bundled regions a country has, or 0 when it has none. */
export function regionCountForCountry(countryId: string): number {
  return getIndex().regionCounts.get(countryId) ?? 0;
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
