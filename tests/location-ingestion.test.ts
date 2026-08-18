import type * as Location from "expo-location";
import { describe, expect, it, vi } from "vitest";

import { ingestNormalizedSamples } from "@/src/data/app-repository";

vi.mock("@/src/data/app-repository", () => ({
  ingestNormalizedSamples: vi.fn(),
}));

import {
  ingestExpoLocations,
  normalizeExpoLocation,
} from "../src/location/location-ingestion";
import { getLocationSnapshot } from "../src/location/location-state";

function locationObject(
  overrides: {
    accuracy?: number | null;
    latitude?: number;
    longitude?: number;
    timestamp?: number;
  } = {},
): Location.LocationObject {
  return {
    coords: {
      accuracy: overrides.accuracy === undefined ? 8 : overrides.accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      latitude: overrides.latitude ?? 52.52,
      longitude: overrides.longitude ?? 13.405,
      speed: null,
    },
    mocked: false,
    timestamp: overrides.timestamp ?? Date.parse("2026-01-01T12:00:00.000Z"),
  };
}

describe("normalizeExpoLocation", () => {
  it("normalizes a valid native reading without leaking platform fields", () => {
    expect(
      normalizeExpoLocation(locationObject(), "live-foreground"),
    ).toEqual({
      source: "live-foreground",
      recordedAt: "2026-01-01T12:00:00.000Z",
      latitude: 52.52,
      longitude: 13.405,
      horizontalAccuracyM: 8,
    });
  });

  it.each([
    ["missing accuracy", { accuracy: null }],
    ["negative accuracy", { accuracy: -1 }],
    ["invalid latitude", { latitude: 91 }],
    ["invalid longitude", { longitude: -181 }],
    ["invalid timestamp", { timestamp: Number.NaN }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      normalizeExpoLocation(locationObject(overrides), "live-background"),
    ).toBeNull();
  });
});

describe("ingestExpoLocations", () => {
  it("publishes the saved coordinate only after persistence completes", async () => {
    let finishPersistence: (() => void) | undefined;
    vi.mocked(ingestNormalizedSamples).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPersistence = () =>
            resolve({
              receivedCount: 1,
              acceptedCount: 1,
              rejectedCount: 0,
              insertedSampleCount: 1,
              duplicateSampleCount: 0,
              insertedCellCount: 1,
              updatedCellCount: 0,
              rejections: [],
            });
        }),
    );

    const reading = locationObject();
    const ingestion = ingestExpoLocations([reading], "live-foreground");

    expect(getLocationSnapshot().latestCoordinate).toBeUndefined();
    expect(finishPersistence).toBeTypeOf("function");

    finishPersistence?.();
    await ingestion;

    expect(getLocationSnapshot().latestCoordinate).toEqual({
      latitude: reading.coords.latitude,
      longitude: reading.coords.longitude,
      accuracyM: reading.coords.accuracy,
      timestampMs: reading.timestamp,
    });
  });
});
