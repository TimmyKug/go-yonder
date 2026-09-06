import type * as Location from "expo-location";

import { updateLatestCoordinate, updateLocationState } from "./location-state";

import { MAX_LIVE_HORIZONTAL_ACCURACY_M } from "@/src/config/scratch-map-config";
import { ingestNormalizedSamples } from "@/src/data/app-repository";
import type { NormalizedLocationSample } from "@/src/domain/location-sample";


export type LiveLocationSource = "live-background" | "live-foreground";

export async function ingestExpoLocations(
  locations: readonly Location.LocationObject[],
  source: LiveLocationSource,
): Promise<void> {
  const samples: NormalizedLocationSample[] = [];
  let newestAcceptedCoordinate:
    | {
        latitude: number;
        longitude: number;
        accuracyM: number;
        timestampMs: number;
      }
    | undefined;

  for (const location of locations) {
    const sample = normalizeExpoLocation(location, source);

    if (!sample) {
      continue;
    }

    samples.push(sample);
    if (
      sample.horizontalAccuracyM !== undefined &&
      sample.horizontalAccuracyM <= MAX_LIVE_HORIZONTAL_ACCURACY_M &&
      (newestAcceptedCoordinate === undefined ||
        location.timestamp > newestAcceptedCoordinate.timestampMs)
    ) {
      newestAcceptedCoordinate = {
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracyM: sample.horizontalAccuracyM,
        timestampMs: location.timestamp,
      };
    }
  }

  if (samples.length === 0) {
    return;
  }

  try {
    const result = await ingestNormalizedSamples(samples);

    if (result.acceptedCount > 0 && newestAcceptedCoordinate) {
      updateLatestCoordinate(newestAcceptedCoordinate);
    }

    if (result.acceptedCount > 0) {
      updateLocationState((current) =>
        current.error?.code === "location-update-failed" ||
        current.error?.code === "ingestion-failed"
          ? { error: null }
          : {},
      );
    }
  } catch {
    updateLocationState({
      error: {
        code: "ingestion-failed",
        message: "A location update could not be saved on this device.",
      },
    });
  }
}

export function normalizeExpoLocation(
  location: Location.LocationObject,
  source: LiveLocationSource,
): NormalizedLocationSample | null {
  const { accuracy, latitude, longitude } = location.coords;

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    accuracy === null ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    !Number.isFinite(location.timestamp)
  ) {
    return null;
  }

  const recordedAt = new Date(location.timestamp);

  if (Number.isNaN(recordedAt.getTime())) {
    return null;
  }

  return {
    source,
    recordedAt: recordedAt.toISOString(),
    latitude,
    longitude,
    horizontalAccuracyM: accuracy,
  };
}
