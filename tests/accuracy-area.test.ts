import { describe, expect, it } from "vitest";

import {
  accuracyAreaCollection,
  accuracyAreaPolygon,
  formatAccuracy,
} from "@/src/domain/accuracy-area";

const EARTH_RADIUS_M = 6_371_008.8;

function distanceM([lng1, lat1]: number[], [lng2, lat2]: number[]): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2! - lat1!) / 2) ** 2 +
    Math.cos(toRad(lat1!)) * Math.cos(toRad(lat2!)) * Math.sin(toRad(lng2! - lng1!) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

describe("accuracy area", () => {
  it("draws a closed ring whose points all lie at the accuracy radius", () => {
    const ring = accuracyAreaPolygon(10, 20, 320).geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const point of ring) {
      expect(distanceM([20, 10], point)).toBeCloseTo(320, 3);
    }
  });

  it("keeps longitudes in range across the antimeridian", () => {
    const ring = accuracyAreaPolygon(0, 179.999, 2_000).geometry.coordinates[0]!;
    expect(ring.every(([lng]) => lng! >= -180 && lng! <= 180)).toBe(true);
  });

  it("draws nothing without a usable accuracy", () => {
    expect(accuracyAreaCollection(undefined).features).toEqual([]);
    expect(accuracyAreaCollection({ latitude: 10, longitude: 20, accuracyM: 0 }).features).toEqual([]);
    expect(accuracyAreaCollection({ latitude: 10, longitude: 20, accuracyM: Number.NaN }).features).toEqual([]);
    expect(accuracyAreaCollection({ latitude: 10, longitude: 20, accuracyM: 80 }).features).toHaveLength(1);
  });

  it("formats accuracy coarsely", () => {
    expect(formatAccuracy(42.4)).toBe("±42 m");
    expect(formatAccuracy(317)).toBe("±320 m");
    expect(formatAccuracy(1_249)).toBe("±1.2 km");
  });
});
