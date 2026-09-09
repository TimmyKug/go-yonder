import { cellToLatLng, getResolution, isValidCell } from "h3-js";

import { YONDER_H3_RESOLUTION } from "@/src/config/yonder-config";
import type { SqlDatabase, SqlExecutor } from "@/src/data/sql-database";

type BackupCell = {
  cell_id: string;
  resolution: number;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
};

/** Reads a separate snapshot; never replaces the live database. */
export async function mergeBackupUnlocks(source: SqlExecutor, target: SqlDatabase) {
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
    "SELECT type FROM sqlite_schema WHERE name = 'unlocked_cells'",
  );
  if (table?.type !== "table") throw new Error("This is not a Yonder backup.");
  const cells = await source.all<BackupCell>(
    "SELECT cell_id, resolution, first_seen_at_ms, last_seen_at_ms FROM unlocked_cells",
  );
  // Validate the entire snapshot before writing any local data.
  for (const cell of cells) {
    if (
      typeof cell.cell_id !== "string" || !/^[0-9a-f]{15}$/.test(cell.cell_id) || !isValidCell(cell.cell_id) ||
      cell.resolution !== YONDER_H3_RESOLUTION ||
      getResolution(cell.cell_id) !== cell.resolution ||
      !Number.isSafeInteger(cell.first_seen_at_ms) ||
      !Number.isSafeInteger(cell.last_seen_at_ms) ||
      cell.first_seen_at_ms > cell.last_seen_at_ms
    ) throw new Error("This backup contains invalid or unsupported tiles.");
  }
  return target.withExclusiveTransaction(async (transaction) => {
    let addedCount = 0;
    for (const cell of cells) {
      const [latitude, longitude] = cellToLatLng(cell.cell_id);
      const inserted = await transaction.run(`
        INSERT INTO unlocked_cells (cell_id, resolution, center_latitude,
          center_longitude, first_seen_at_ms, last_seen_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (cell_id, resolution) DO NOTHING
      `, [cell.cell_id, cell.resolution, latitude, longitude,
        cell.first_seen_at_ms, cell.last_seen_at_ms]);
      addedCount += inserted.changes;
      if (!inserted.changes) {
        await transaction.run(`UPDATE unlocked_cells SET
          first_seen_at_ms = MIN(first_seen_at_ms, ?),
          last_seen_at_ms = MAX(last_seen_at_ms, ?)
          WHERE cell_id = ? AND resolution = ?`,
        [cell.first_seen_at_ms, cell.last_seen_at_ms, cell.cell_id, cell.resolution]);
      }
    }
    return { addedCount, totalCount: cells.length };
  });
}
