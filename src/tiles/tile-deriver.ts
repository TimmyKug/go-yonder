import { AppState } from "react-native";

import { requestCountryScan } from "@/src/countries/country-scanner";
import { getCountryCache } from "@/src/data/country-cache-database";
import { resetCountryCache } from "@/src/data/country-cache-repository";
import { getDatabase } from "@/src/data/database";
import { ensureTileCursor, writeTileCursor } from "@/src/data/tile-cursor";
import { countSamplesAfter, deriveTilesAfter } from "@/src/data/tile-derivation-repository";
import { recordDiagnostic } from "@/src/diagnostics/diagnostics";

// Samples per step. Each step is one short transaction, then the JS thread is
// released so the map stays responsive.
const STEP_SIZE = 2_000;
// Visible tiles refresh at most this often while tiles are being derived.
const REFRESH_INTERVAL_MS = 1_000;

export type TileDerivationSnapshot = Readonly<{
  running: boolean;
  /** Samples handled in this run, and how many the run started with. */
  processedCount: number;
  totalCount: number;
  /** Increases whenever tiles changed, so views can reload them. */
  revision: number;
}>;

let snapshot: TileDerivationSnapshot = { running: false, processedCount: 0, totalCount: 0, revision: 0 };
const listeners = new Set<() => void>();
let running = false;
let rerun = false;

function setSnapshot(next: Partial<TileDerivationSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

async function run() {
  running = true;
  const startedAtMs = Date.now();
  let lastRefreshMs = 0;
  let processedCount = 0;
  let addedTileCount = 0;
  let changedTileCount = 0;
  try {
    const database = await getDatabase();
    let cursor = await ensureTileCursor(database);
    const totalCount = await countSamplesAfter(database, cursor);
    if (totalCount === 0) return;
    setSnapshot({ running: true, processedCount: 0, totalCount });

    while (AppState.currentState !== "background" && !rerun) {
      const step = await deriveTilesAfter(database, cursor, STEP_SIZE);
      if (step.processedCount === 0) break;
      // The tiles are committed before the cursor moves, so an interruption
      // only repeats an idempotent step.
      cursor = step.cursor;
      await writeTileCursor(cursor);
      processedCount += step.processedCount;
      addedTileCount += step.addedTileCount;
      changedTileCount += step.changedTileCount;
      const now = Date.now();
      const refresh = step.changedTileCount > 0 && now - lastRefreshMs >= REFRESH_INTERVAL_MS;
      if (refresh) lastRefreshMs = now;
      setSnapshot({
        processedCount: Math.min(processedCount, totalCount),
        ...(refresh ? { revision: snapshot.revision + 1 } : {}),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } catch {
    // The cursor only moves after a committed step; the next run retries.
  } finally {
    running = false;
    setSnapshot({
      running: false,
      ...(changedTileCount > 0 ? { revision: snapshot.revision + 1 } : {}),
    });
    if (processedCount > 0) {
      recordDiagnostic("tiles-derived", {
        durationMs: Date.now() - startedAtMs,
        pointCount: processedCount,
        addedTileCount,
      });
    }
    if (changedTileCount > 0) {
      // New or earlier visits change country coverage and first visits.
      await getCountryCache().then(resetCountryCache).catch(() => undefined);
      requestCountryScan();
    }
    if (rerun) {
      rerun = false;
      void run();
    }
  }
}

/**
 * Derives tiles for imported points in the background. Cheap to call often:
 * it only processes samples after its saved cursor, and resumes where it
 * stopped after the app was backgrounded or closed.
 */
export function requestTileDerivation(): void {
  if (running) {
    rerun = true;
    return;
  }
  void run();
}

export function getTileDerivationSnapshot(): TileDerivationSnapshot {
  return snapshot;
}

export function subscribeToTileDerivation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

AppState.addEventListener("change", (state) => {
  if (state === "active") requestTileDerivation();
});
