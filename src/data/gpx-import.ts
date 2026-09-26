import { parseGpx } from "../domain/gpx";
import type { IngestionResult } from "../domain/ingest-location";
import type { NormalizedLocationSample } from "../domain/location-sample";

import { createStoredPointMatcher } from "./location-sample-repository";
import type { SqlExecutor } from "./sql-database";

export type GpxImportResult = {
  /** Points with a time and coordinate found in the file. */
  pointCount: number;
  addedPointCount: number;
  /** Points already stored, e.g. from importing Yonder's own export. */
  alreadyStoredCount: number;
  addedTileCount: number;
  /** Points without a time, or with an invalid time or coordinate. */
  skippedCount: number;
};

type GpxImportDependencies = {
  database: SqlExecutor;
  ingest: (samples: readonly NormalizedLocationSample[]) => Promise<IngestionResult>;
  onProgress?: (processedCount: number, totalCount: number) => void;
};

const IMPORT_CHUNK_SIZE = 1_000;

/** Stored sample times have whole-second precision. */
function wholeSecondMs(recordedAt: string): number {
  return Math.floor(Date.parse(recordedAt) / 1000) * 1000;
}

/**
 * Adds a GPX file's points as imported history. Re-importing a file, or
 * importing Yonder's own export on the same phone, adds nothing.
 */
export async function importGpxText(
  text: string,
  { database, ingest, onProgress }: GpxImportDependencies,
): Promise<GpxImportResult> {
  const parsed = parseGpx(text);
  const points = parsed.points
    .map((point) => ({ ...point, recordedAtMs: wholeSecondMs(point.recordedAt) }))
    .sort((a, b) => (a.recordedAtMs || 0) - (b.recordedAtMs || 0));
  const result: GpxImportResult = {
    pointCount: points.length,
    addedPointCount: 0,
    alreadyStoredCount: 0,
    addedTileCount: 0,
    skippedCount: parsed.skippedWithoutTimeCount + parsed.skippedInvalidCount,
  };

  for (let start = 0; start < points.length; start += IMPORT_CHUNK_SIZE) {
    const chunk = points.slice(start, start + IMPORT_CHUNK_SIZE);
    const times = chunk.map(({ recordedAtMs }) => recordedAtMs).filter(Number.isFinite);
    const isStored = times.length > 0
      ? await createStoredPointMatcher(database, Math.min(...times), Math.max(...times))
      : () => false;
    const samples: NormalizedLocationSample[] = [];
    for (const point of chunk) {
      if (Number.isFinite(point.recordedAtMs) && isStored(point)) {
        result.alreadyStoredCount += 1;
        continue;
      }
      samples.push({
        source: "external-import",
        recordedAt: point.recordedAt,
        latitude: point.latitude,
        longitude: point.longitude,
        ...(point.horizontalAccuracyM === undefined ? {} : { horizontalAccuracyM: point.horizontalAccuracyM }),
      });
    }
    if (samples.length > 0) {
      const ingested = await ingest(samples);
      result.addedPointCount += ingested.insertedSampleCount;
      result.alreadyStoredCount += ingested.duplicateSampleCount;
      result.addedTileCount += ingested.insertedCellCount;
      result.skippedCount += ingested.rejectedCount;
    }
    onProgress?.(Math.min(start + IMPORT_CHUNK_SIZE, points.length), points.length);
  }

  return result;
}
