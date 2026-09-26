import type * as Location from "expo-location";
import { describe, expect, it, vi } from "vitest";

import { ingestNormalizedSamples } from "@/src/data/app-repository";

vi.mock("@/src/data/app-repository", () => ({
  ingestNormalizedSamples: vi.fn(),
}));

const accuracyPreference = vi.hoisted(() => ({ maxM: 100 }));
vi.mock("@/src/data/accuracy-preference", () => ({
  readMaxLiveAccuracyM: () => accuracyPreference.maxM,
}));

import {
  ingestExpoLocations,
  normalizeExpoLocation,
} from "../src/location/location-ingestion";
import {
  getLocationSnapshot,
  updateLocationState,
} from "../src/location/location-state";

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

  it("clears a recoverable location error after a sample is saved", async () => {
    updateLocationState({
      error: {
        code: "location-update-failed",
        message: "Temporary native location failure.",
      },
    });
    vi.mocked(ingestNormalizedSamples).mockResolvedValueOnce({
      receivedCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      insertedSampleCount: 1,
      duplicateSampleCount: 0,
      insertedCellCount: 1,
      updatedCellCount: 0,
      rejections: [],
    });

    await ingestExpoLocations(
      [locationObject({ timestamp: Date.parse("2026-01-01T12:01:00.000Z") })],
      "live-background",
    );

    expect(getLocationSnapshot().error).toBeNull();
  });
  it("shows an inaccurate fix on the map without treating it as a saved location", async () => {
    vi.mocked(ingestNormalizedSamples).mockResolvedValueOnce({
      receivedCount: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      insertedSampleCount: 0,
      duplicateSampleCount: 0,
      insertedCellCount: 0,
      updatedCellCount: 0,
      rejections: [],
    });
    const saved = getLocationSnapshot().latestCoordinate;
    const reading = locationObject({
      accuracy: 420,
      latitude: 10,
      longitude: 20,
      timestamp: Date.parse("2026-01-01T12:02:00.000Z"),
    });

    await ingestExpoLocations([reading], "live-background");

    expect(getLocationSnapshot().latestFix).toEqual({
      latitude: 10,
      longitude: 20,
      accuracyM: 420,
      timestampMs: reading.timestamp,
    });
    expect(getLocationSnapshot().latestCoordinate).toEqual(saved);
  });

  it("applies the accuracy limit chosen in Settings", async () => {
    vi.mocked(ingestNormalizedSamples).mockResolvedValueOnce({
      receivedCount: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      insertedSampleCount: 0,
      duplicateSampleCount: 0,
      insertedCellCount: 0,
      updatedCellCount: 0,
      rejections: [],
    });
    accuracyPreference.maxM = 25;
    const saved = getLocationSnapshot().latestCoordinate;

    await ingestExpoLocations(
      [locationObject({ accuracy: 40, timestamp: Date.parse("2026-01-01T12:03:00.000Z") })],
      "live-foreground",
    );

    expect(vi.mocked(ingestNormalizedSamples)).toHaveBeenLastCalledWith(expect.any(Array), 25);
    expect(getLocationSnapshot().latestCoordinate).toEqual(saved);
    accuracyPreference.maxM = 100;
  });

  it("keeps the newest fix when an older batch arrives late", async () => {
    vi.mocked(ingestNormalizedSamples).mockResolvedValue({
      receivedCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      insertedSampleCount: 1,
      duplicateSampleCount: 0,
      insertedCellCount: 0,
      updatedCellCount: 0,
      rejections: [],
    });
    const newer = Date.parse("2026-01-01T12:05:00.000Z");
    await ingestExpoLocations([locationObject({ timestamp: newer, accuracy: 5 })], "live-foreground");
    await ingestExpoLocations(
      [locationObject({ timestamp: newer - 60_000, accuracy: 900 })],
      "live-background",
    );

    expect(getLocationSnapshot().latestFix?.timestampMs).toBe(newer);
    expect(getLocationSnapshot().latestFix?.accuracyM).toBe(5);
    vi.mocked(ingestNormalizedSamples).mockReset();
  });
});
