import { parseGpx } from "../domain/gpx";

import { createStoredPointMatcher } from "./location-sample-repository";
import {
  cellsForSamples,
  insertNewSamples,
  mergeDerivedCells,
  type PreparedSampleRow,
  prepareImportedSample,
} from "./sample-merge-repository";
import type { SqlDatabase } from "./sql-database";

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
  database: SqlDatabase;
  onProgress?: (processedCount: number, totalCount: number) => void;
};

// Each chunk commits on its own, so a very large file never holds the
// database for long and an interrupted import keeps what it finished.
const IMPORT_CHUNK_SIZE = 1_000;

/** Stored sample times have whole-second precision. */
function wholeSecondMs(recordedAt: string): number {
  return Math.floor(Date.parse(recordedAt) / 1000) * 1000;
}

/**
 * Adds a GPX file's points as imported history and derives their tiles.
 * Re-importing a file, or importing Yonder's own export on the same phone,
 * adds nothing.
 */
export async function importGpxText(
  text: string,
  { database, onProgress }: GpxImportDependencies,
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
    const rows: PreparedSampleRow[] = [];
    for (const point of chunk) {
      if (Number.isFinite(point.recordedAtMs) && isStored(point)) {
        result.alreadyStoredCount += 1;
        continue;
      }
      const row = prepareImportedSample({
        source: "external-import",
        recordedAt: point.recordedAt,
        latitude: point.latitude,
        longitude: point.longitude,
        ...(point.horizontalAccuracyM === undefined ? {} : { horizontalAccuracyM: point.horizontalAccuracyM }),
      });
      if (row) rows.push(row);
      else result.skippedCount += 1;
    }
    if (rows.length > 0) {
      const { added, tiles } = await database.withExclusiveTransaction(async (transaction) => {
        const inserted = await insertNewSamples(transaction, rows);
        return { added: inserted, tiles: await mergeDerivedCells(transaction, cellsForSamples(inserted)) };
      });
      result.addedPointCount += added.length;
      result.alreadyStoredCount += rows.length - added.length;
      result.addedTileCount += tiles;
    }
    onProgress?.(Math.min(start + IMPORT_CHUNK_SIZE, points.length), points.length);
  }

  return result;
}
