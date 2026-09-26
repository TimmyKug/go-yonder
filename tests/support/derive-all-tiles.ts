import type { SqlDatabase } from "../../src/data/sql-database";
import { readTileCursor, writeTileCursor } from "../../src/data/tile-cursor";
import { deriveTilesAfter } from "../../src/data/tile-derivation-repository";

/** Runs the background tile deriver's steps to completion, as the app does. */
export async function deriveAllTiles(database: SqlDatabase, stepSize = 2_000) {
  let cursor = readTileCursor() ?? 0;
  let addedTileCount = 0;
  for (;;) {
    const step = await deriveTilesAfter(database, cursor, stepSize);
    if (step.processedCount === 0) return { addedTileCount, cursor };
    cursor = step.cursor;
    addedTileCount += step.addedTileCount;
    await writeTileCursor(cursor);
  }
}
