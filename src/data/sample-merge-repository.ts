import { cellToLatLng, latLngToCell } from "h3-js";

import { YONDER_H3_RESOLUTION } from "@/src/config/yonder-config";
import type { SqlExecutor, SqlValue } from "@/src/data/sql-database";
import {
  type NormalizedLocationSample,
  validateNormalizedLocationSample,
} from "@/src/domain/location-sample";

// Each statement is several native round trips on a device, so imports write
// in multi-row batches. 120 samples use 960 bound parameters and 500 cells
// 3,000, well under the bundled SQLite's limit of 32,766.
const SAMPLE_BATCH_SIZE = 120;
const CELL_BATCH_SIZE = 500;

/** source, source_record_id, recorded_at_ms, latitude, longitude, accuracy, import_batch_id, fingerprint */
export type PreparedSampleRow = [string, string | null, number, number, number, number | null, null, string];

type ExistingCell = {
  cell_id: string;
  center_latitude: number;
  center_longitude: number;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
};

type DerivedCell = { cellId: string; firstSeenAtMs: number; lastSeenAtMs: number };

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Validates an imported point without the live accuracy limit, because it was
 * accepted when it was recorded. Returns null for a point that cannot be
 * stored. The fingerprint is always computed here, never taken from a file.
 */
export function prepareImportedSample(candidate: NormalizedLocationSample): PreparedSampleRow | null {
  const validated = validateNormalizedLocationSample(candidate, {});
  if (!validated.accepted) return null;
  const sample = validated.sample;
  // An import batch ID belongs to the device that created it.
  return [sample.source, sample.sourceRecordId ?? null, sample.recordedAtMs, sample.latitude,
    sample.longitude, sample.horizontalAccuracyM ?? null, null, sample.fingerprint];
}

/** Inserts the rows not stored yet and returns exactly those. */
export async function insertNewSamples(
  transaction: SqlExecutor,
  rows: readonly PreparedSampleRow[],
): Promise<PreparedSampleRow[]> {
  const inserted: PreparedSampleRow[] = [];
  for (let start = 0; start < rows.length; start += SAMPLE_BATCH_SIZE) {
    const batch = rows.slice(start, start + SAMPLE_BATCH_SIZE);
    const existing = new Set((await transaction.all<{ fingerprint: string }>(
      `SELECT fingerprint FROM location_samples WHERE fingerprint IN (${placeholders(batch.length)})`,
      batch.map((row) => row[7]),
    )).map((row) => row.fingerprint));
    // A file can repeat a point; keep the first.
    const fresh = new Map<string, PreparedSampleRow>();
    for (const row of batch) {
      if (!existing.has(row[7]) && !fresh.has(row[7])) fresh.set(row[7], row);
    }
    if (fresh.size === 0) continue;
    const newRows = [...fresh.values()];
    await transaction.run(`
      INSERT INTO location_samples (source, source_record_id, recorded_at_ms,
        latitude, longitude, horizontal_accuracy_m, import_batch_id, fingerprint)
      VALUES ${newRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
    `, newRows.flat());
    inserted.push(...newRows);
  }
  return inserted;
}

/** Tiles are derived from points: one per resolution-11 cell with its visit window. */
export function cellsForSamples(rows: readonly PreparedSampleRow[]): DerivedCell[] {
  const cells = new Map<string, DerivedCell>();
  for (const row of rows) {
    const recordedAtMs = row[2];
    const cellId = latLngToCell(row[3], row[4], YONDER_H3_RESOLUTION);
    const cell = cells.get(cellId);
    if (cell) {
      cell.firstSeenAtMs = Math.min(cell.firstSeenAtMs, recordedAtMs);
      cell.lastSeenAtMs = Math.max(cell.lastSeenAtMs, recordedAtMs);
    } else {
      cells.set(cellId, { cellId, firstSeenAtMs: recordedAtMs, lastSeenAtMs: recordedAtMs });
    }
  }
  return [...cells.values()];
}

/**
 * Unlocks derived cells, widening the visit window of cells already unlocked.
 * Returns how many cells are new.
 */
export async function mergeDerivedCells(
  transaction: SqlExecutor,
  cells: readonly DerivedCell[],
): Promise<number> {
  let addedCount = 0;
  for (let start = 0; start < cells.length; start += CELL_BATCH_SIZE) {
    const batch = cells.slice(start, start + CELL_BATCH_SIZE);
    const existing = new Map((await transaction.all<ExistingCell>(
      `SELECT cell_id, center_latitude, center_longitude, first_seen_at_ms, last_seen_at_ms
       FROM unlocked_cells WHERE resolution = ? AND cell_id IN (${placeholders(batch.length)})`,
      [YONDER_H3_RESOLUTION, ...batch.map((cell) => cell.cellId)],
    )).map((row) => [row.cell_id, row]));

    // Only new cells and cells whose visit window widens need a write, and
    // only new cells need their center derived.
    const rows: SqlValue[][] = [];
    for (const cell of batch) {
      const local = existing.get(cell.cellId);
      if (!local) {
        const [latitude, longitude] = cellToLatLng(cell.cellId);
        rows.push([cell.cellId, YONDER_H3_RESOLUTION, latitude, longitude, cell.firstSeenAtMs, cell.lastSeenAtMs]);
        addedCount += 1;
      } else if (cell.firstSeenAtMs < local.first_seen_at_ms || cell.lastSeenAtMs > local.last_seen_at_ms) {
        rows.push([cell.cellId, YONDER_H3_RESOLUTION, local.center_latitude, local.center_longitude,
          cell.firstSeenAtMs, cell.lastSeenAtMs]);
      }
    }
    if (rows.length === 0) continue;

    await transaction.run(`
      INSERT INTO unlocked_cells (cell_id, resolution, center_latitude,
        center_longitude, first_seen_at_ms, last_seen_at_ms)
      VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
      ON CONFLICT (cell_id, resolution) DO UPDATE SET
        first_seen_at_ms = MIN(first_seen_at_ms, excluded.first_seen_at_ms),
        last_seen_at_ms = MAX(last_seen_at_ms, excluded.last_seen_at_ms)
    `, rows.flat());
  }
  return addedCount;
}
