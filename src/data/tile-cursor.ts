import Storage from "expo-sqlite/kv-store";

import type { SqlExecutor } from "./sql-database";
import { latestSampleId } from "./tile-derivation-repository";

// The highest location sample ID whose tile has been derived. Live ingestion
// unlocks its tiles immediately; imports only store points and leave their
// tiles to the background deriver, which resumes from here.
const CURSOR_KEY = "tile-derivation-cursor";

export function readTileCursor(): number | undefined {
  try {
    const value = Number(Storage.getItemSync(CURSOR_KEY));
    return Storage.getItemSync(CURSOR_KEY) !== null && Number.isSafeInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function writeTileCursor(cursor: number): Promise<void> {
  await Storage.setItemAsync(CURSOR_KEY, String(cursor));
}

/**
 * Every sample stored before this version already has its tile, so the first
 * cursor is the newest sample. Called before an import writes points.
 */
export async function ensureTileCursor(database: SqlExecutor): Promise<number> {
  const cursor = readTileCursor();
  if (cursor !== undefined) return cursor;
  const initial = await latestSampleId(database);
  await writeTileCursor(initial);
  return initial;
}
