import type { ValidatedLocationSample } from "./location-sample";

export type GeographicCoordinate = {
  latitude: number;
  longitude: number;
};

export type GeographicBounds = {
  south: number;
  north: number;
  west: number;
  east: number;
};

export type UnlockedCell = {
  cellId: string;
  resolution: number;
  centerLatitude: number;
  centerLongitude: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
};

export type PreparedLocationObservation = {
  sample: ValidatedLocationSample;
  cell: UnlockedCell;
};

export function assertValidResolution(resolution: number): void {
  if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15) {
    throw new RangeError("resolution must be an integer between 0 and 15");
  }
}

export function assertValidGeographicBounds(bounds: GeographicBounds): void {
  const values = [bounds.south, bounds.north, bounds.west, bounds.east];
  if (!values.every(Number.isFinite)) {
    throw new RangeError("geographic bounds must contain finite numbers");
  }
  if (bounds.south < -90 || bounds.north > 90 || bounds.south > bounds.north) {
    throw new RangeError("latitude bounds must satisfy -90 <= south <= north <= 90");
  }
  if (bounds.west < -180 || bounds.west > 180 || bounds.east < -180 || bounds.east > 180) {
    throw new RangeError("longitude bounds must be between -180 and 180");
  }
}
