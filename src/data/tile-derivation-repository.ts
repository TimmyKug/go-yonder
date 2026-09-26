import { latLngToCell } from "h3-js";

import { YONDER_H3_RESOLUTION } from "@/src/config/yonder-config";
import { mergeDerivedCells } from "@/src/data/sample-merge-repository";
import type { SqlDatabase, SqlExecutor } from "@/src/data/sql-database";

type SampleRow = { id: number; latitude: number; longitude: number; recorded_at_ms: number };

export type TileDerivationStep = {
  /** The highest sample ID now covered by tiles. */
  cursor: number;
  processedCount: number;
  addedTileCount: number;
  /** Tiles added or whose visit window widened. */
  changedTileCount: number;
};

/** Samples not yet covered by tiles, for progress. */
export async function countSamplesAfter(database: SqlExecutor, cursor: number): Promise<number> {
  return (await database.first<{ count: number }>(
    "SELECT COUNT(*) AS count FROM location_samples WHERE id > ?", [cursor],
  ))?.count ?? 0;
}

export async function latestSampleId(database: SqlExecutor): Promise<number> {
  return (await database.first<{ id: number | null }>("SELECT MAX(id) AS id FROM location_samples"))?.id ?? 0;
}

/**
 * Derives the tiles of the next `limit` samples after `cursor` and merges them
 * in one transaction. Merging is idempotent, so repeating a step after an
 * interruption is harmless.
 */
export async function deriveTilesAfter(
  database: SqlDatabase,
  cursor: number,
  limit: number,
): Promise<TileDerivationStep> {
  const rows = await database.all<SampleRow>(
    "SELECT id, latitude, longitude, recorded_at_ms FROM location_samples WHERE id > ? ORDER BY id LIMIT ?",
    [cursor, limit],
  );
  if (rows.length === 0) return { cursor, processedCount: 0, addedTileCount: 0, changedTileCount: 0 };

  const cells = new Map<string, { cellId: string; firstSeenAtMs: number; lastSeenAtMs: number }>();
  // Consecutive samples often repeat a position; skip the H3 call for those.
  let previousLatitude = Number.NaN;
  let previousLongitude = Number.NaN;
  let cellId = "";
  for (const row of rows) {
    if (row.latitude !== previousLatitude || row.longitude !== previousLongitude) {
      cellId = latLngToCell(row.latitude, row.longitude, YONDER_H3_RESOLUTION);
      previousLatitude = row.latitude;
      previousLongitude = row.longitude;
    }
    const cell = cells.get(cellId);
    if (cell) {
      cell.firstSeenAtMs = Math.min(cell.firstSeenAtMs, row.recorded_at_ms);
      cell.lastSeenAtMs = Math.max(cell.lastSeenAtMs, row.recorded_at_ms);
    } else {
      cells.set(cellId, { cellId, firstSeenAtMs: row.recorded_at_ms, lastSeenAtMs: row.recorded_at_ms });
    }
  }

  const { addedCount, changedCount } = await database.withExclusiveTransaction((transaction) =>
    mergeDerivedCells(transaction, [...cells.values()]));
  return {
    cursor: rows.at(-1)!.id,
    processedCount: rows.length,
    addedTileCount: addedCount,
    changedTileCount: changedCount,
  };
}
