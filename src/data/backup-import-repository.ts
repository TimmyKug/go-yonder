import type { SqlDatabase, SqlExecutor } from "@/src/data/sql-database";
import {
  cellsForSamples,
  insertNewSamples,
  mergeDerivedCells,
  type PreparedSampleRow,
  prepareImportedSample,
} from "@/src/data/sample-merge-repository";

// Reading the snapshot in pages keeps memory bounded for large histories.
const READ_PAGE_SIZE = 1_000;

type BackupSample = {
  id: number;
  source: string;
  source_record_id: string | null;
  recorded_at_ms: number;
  latitude: number;
  longitude: number;
  horizontal_accuracy_m: number | null;
};

export type BackupImportResult = {
  addedTileCount: number;
  addedPointCount: number;
  totalPointCount: number;
  /** Points that could not be read; the rest of the backup is still imported. */
  skippedPointCount: number;
};

function toSampleRow(row: BackupSample): PreparedSampleRow | null {
  if (typeof row.recorded_at_ms !== "number" || !Number.isSafeInteger(row.recorded_at_ms)) return null;
  const date = new Date(row.recorded_at_ms);
  if (!Number.isFinite(date.getTime())) return null;
  return prepareImportedSample({
    source: row.source as never,
    sourceRecordId: row.source_record_id ?? undefined,
    recordedAt: date.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    horizontalAccuracyM: row.horizontal_accuracy_m ?? undefined,
  });
}

/**
 * Imports a backup's GPS points and derives their tiles. GPS points are the
 * source of truth: the backup's stored tiles are ignored. Reads a separate
 * snapshot and never replaces the live database.
 */
export async function importBackupSamples(
  source: SqlExecutor,
  target: SqlDatabase,
): Promise<BackupImportResult> {
  await source.execute("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON");
  const version = await source.first<{ user_version: number }>("PRAGMA user_version");
  if (version?.user_version !== 3) {
    throw new Error("Unsupported backup version. Choose a Yonder backup from a compatible release.");
  }
  const integrity = await source.first<{ integrity_check: string }>("PRAGMA integrity_check");
  if (integrity?.integrity_check !== "ok") {
    throw new Error("This backup is damaged.");
  }
  const table = await source.first<{ type: string }>(
    "SELECT type FROM sqlite_schema WHERE name = 'location_samples'",
  );
  if (table?.type !== "table") {
    throw new Error("This backup has no GPS points. Import the GPS data it was made from instead.");
  }

  return target.withExclusiveTransaction(async (transaction) => {
    const inserted: PreparedSampleRow[] = [];
    let totalPointCount = 0;
    let skippedPointCount = 0;
    let cursor = -Number.MAX_SAFE_INTEGER;
    for (;;) {
      const page = await source.all<BackupSample>(`
        SELECT id, source, source_record_id, recorded_at_ms, latitude, longitude, horizontal_accuracy_m
        FROM location_samples WHERE id > ? ORDER BY id LIMIT ?
      `, [cursor, READ_PAGE_SIZE]);
      if (page.length === 0) break;
      // The row ID only pages through the snapshot; a broken one would loop.
      if (page.some(({ id }) => !Number.isSafeInteger(id)) || page[0]!.id <= cursor) {
        throw new Error("This backup is damaged.");
      }
      cursor = page.at(-1)!.id;
      totalPointCount += page.length;

      const rows = page.map(toSampleRow).filter((row): row is PreparedSampleRow => row !== null);
      skippedPointCount += page.length - rows.length;
      inserted.push(...(await insertNewSamples(transaction, rows)));
    }

    const addedTileCount = await mergeDerivedCells(transaction, cellsForSamples(inserted));
    return { addedTileCount, addedPointCount: inserted.length, totalPointCount, skippedPointCount };
  });
}
