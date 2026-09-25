import { cellToParent } from "h3-js";

import { YONDER_H3_RESOLUTION } from "@/src/config/yonder-config";
import {
  commitScannedCells,
  prepareCountryCache,
  readPendingCoverage,
  readUnscannedCells,
  saveCoverage,
  type ScannedCell,
} from "@/src/data/country-cache-repository";
import type { SqlDatabase } from "@/src/data/sql-database";
import { COUNTRY_COVERAGE_RESOLUTION, type CountryIndex } from "@/src/domain/country-coverage";

const PAGE_SIZE = 128;

export type CountryScanStep = {
  /** False once the scan should stop and resume later, e.g. in the background. */
  shouldContinue: () => boolean;
  /** Lets the app handle input between small amounts of work. */
  pause: () => Promise<void>;
  /** Called after each saved step so results can appear progressively. */
  onProgress: () => void;
};

/**
 * Scans unlocked cells not yet in the cache, then computes the clipped area
 * of every explored coarse hex still missing one. Every step is saved, so a
 * stopped scan resumes where it left off. Returns true when it is complete.
 */
export async function scanCountries(
  main: SqlDatabase,
  cache: SqlDatabase,
  index: CountryIndex,
  boundaries: string,
  { shouldContinue, pause, onProgress }: CountryScanStep,
): Promise<boolean> {
  let state = await prepareCountryCache(cache, main, boundaries);

  while (shouldContinue()) {
    const rows = await readUnscannedCells(main, state.lastRowId, PAGE_SIZE, YONDER_H3_RESOLUTION);
    if (rows.length === 0) break;
    const scanned: ScannedCell[] = [];
    for (const row of rows) {
      await pause();
      const country = index.countryForCell(row.cell_id);
      if (country) {
        scanned.push({
          countryId: country.id,
          parentId: cellToParent(row.cell_id, COUNTRY_COVERAGE_RESOLUTION),
          firstSeenAtMs: row.first_seen_at_ms,
        });
      }
    }
    const lastRowId = rows.at(-1)!.rowid;
    if (await commitScannedCells(cache, state.generation, lastRowId, scanned)) {
      state = { ...state, lastRowId };
    } else {
      // The cache was reset meanwhile; start over from its new state.
      state = await prepareCountryCache(cache, main, boundaries);
    }
    onProgress();
  }

  while (shouldContinue()) {
    const [pending] = await readPendingCoverage(cache, 1);
    if (!pending) return true;
    await pause();
    const coveredKm2 = index.coveredAreaKm2(pending.parent_id, pending.country_id);
    await saveCoverage(cache, pending.country_id, pending.parent_id, coveredKm2);
    onProgress();
  }
  return false;
}
