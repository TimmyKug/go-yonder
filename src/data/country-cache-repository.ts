import { type CountryCollection, type CountryProperties, type CountryVisit } from "../domain/country-coverage";

import type { DatabaseMigration } from "./migrations";
import type { SqlDatabase, SqlValue } from "./sql-database";

/**
 * A rebuildable cache of which countries the unlocked cells fall in and how
 * much of each country their coarse hexes cover. It lives in its own database
 * so backups keep their schema version and never include it.
 */
export const COUNTRY_CACHE_MIGRATIONS: readonly DatabaseMigration[] = Object.freeze([
  {
    version: 1,
    name: "create-country-cache",
    sql: `
      CREATE TABLE scan_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        generation INTEGER NOT NULL,
        boundaries TEXT NOT NULL,
        last_rowid INTEGER NOT NULL
      );

      CREATE TABLE country_visits (
        country_id TEXT PRIMARY KEY,
        first_seen_at_ms INTEGER NOT NULL
      );

      -- covered_km2 stays NULL until the clipped area has been computed.
      CREATE TABLE country_parents (
        country_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        covered_km2 REAL,
        PRIMARY KEY (country_id, parent_id)
      );
    `,
  },
]);

export type CountryScanState = Readonly<{
  generation: number;
  lastRowId: number;
}>;

export type UnscannedCell = { rowid: number; cell_id: string; first_seen_at_ms: number };

export type ScannedCell = Readonly<{
  countryId: string;
  parentId: string;
  firstSeenAtMs: number;
}>;

/** Changes whenever the bundled boundaries change, which invalidates the cache. */
export function countryBoundariesFingerprint(collection: CountryCollection): string {
  // FNV-1a over every country's identifier and area.
  let hash = 0x811c9dc5;
  for (const { properties } of collection.features) {
    const text = `${properties.id}:${properties.areaKm2};`;
    for (let i = 0; i < text.length; i += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
  }
  return `${collection.features.length}:${hash.toString(16)}`;
}

async function clear(cache: SqlDatabase, boundaries: string): Promise<CountryScanState> {
  return cache.withExclusiveTransaction(async (transaction) => {
    const previous = await transaction.first<{ generation: number }>(
      "SELECT generation FROM scan_state WHERE id = 1",
    );
    const generation = (previous?.generation ?? 0) + 1;
    await transaction.execute("DELETE FROM country_visits; DELETE FROM country_parents");
    await transaction.run(
      `INSERT INTO scan_state (id, generation, boundaries, last_rowid) VALUES (1, ?, ?, 0)
       ON CONFLICT (id) DO UPDATE SET generation = excluded.generation,
         boundaries = excluded.boundaries, last_rowid = 0`,
      [generation, boundaries],
    );
    return { generation, lastRowId: 0 };
  });
}

/**
 * Returns where scanning should resume. Starts over when the boundaries
 * changed or the unlocked cells were replaced, e.g. by a fresh install.
 */
export async function prepareCountryCache(
  cache: SqlDatabase,
  main: SqlDatabase,
  boundaries: string,
): Promise<CountryScanState> {
  const state = await cache.first<{ generation: number; boundaries: string; last_rowid: number }>(
    "SELECT generation, boundaries, last_rowid FROM scan_state WHERE id = 1",
  );
  const newest = await main.first<{ max_rowid: number | null }>(
    "SELECT MAX(rowid) AS max_rowid FROM unlocked_cells",
  );
  if (!state || state.boundaries !== boundaries || state.last_rowid > (newest?.max_rowid ?? 0)) {
    return clear(cache, boundaries);
  }
  return { generation: state.generation, lastRowId: state.last_rowid };
}

/** Forgets every result, e.g. after an import made existing visits earlier. */
export async function resetCountryCache(cache: SqlDatabase): Promise<void> {
  const state = await cache.first<{ boundaries: string }>("SELECT boundaries FROM scan_state WHERE id = 1");
  await clear(cache, state?.boundaries ?? "");
}

/**
 * New cells always get a larger rowid, so the cursor finds only unscanned ones.
 * The unary plus keeps SQLite on the rowid instead of the viewport index, which
 * would scan and sort every cell for each page.
 */
export function readUnscannedCells(
  main: SqlDatabase,
  afterRowId: number,
  limit: number,
  resolution: number,
): Promise<UnscannedCell[]> {
  return main.all<UnscannedCell>(
    `SELECT rowid, cell_id, first_seen_at_ms FROM unlocked_cells
     WHERE rowid > ? AND +resolution = ? ORDER BY rowid LIMIT ?`,
    [afterRowId, resolution, limit],
  );
}

/** Records a scanned page atomically; false when a reset happened meanwhile. */
export async function commitScannedCells(
  cache: SqlDatabase,
  generation: number,
  lastRowId: number,
  cells: readonly ScannedCell[],
): Promise<boolean> {
  const visits = new Map<string, number>();
  const parents = new Set<string>();
  const parentRows: SqlValue[][] = [];
  for (const { countryId, parentId, firstSeenAtMs } of cells) {
    visits.set(countryId, Math.min(visits.get(countryId) ?? firstSeenAtMs, firstSeenAtMs));
    const key = `${countryId}:${parentId}`;
    if (!parents.has(key)) {
      parents.add(key);
      parentRows.push([countryId, parentId]);
    }
  }
  return cache.withExclusiveTransaction(async (transaction) => {
    const state = await transaction.first<{ generation: number }>(
      "SELECT generation FROM scan_state WHERE id = 1",
    );
    if (state?.generation !== generation) return false;
    if (visits.size > 0) {
      await transaction.run(
        `INSERT INTO country_visits (country_id, first_seen_at_ms)
         VALUES ${[...visits].map(() => "(?, ?)").join(", ")}
         ON CONFLICT (country_id) DO UPDATE SET
           first_seen_at_ms = MIN(first_seen_at_ms, excluded.first_seen_at_ms)`,
        [...visits].flat(),
      );
      await transaction.run(
        `INSERT OR IGNORE INTO country_parents (country_id, parent_id)
         VALUES ${parentRows.map(() => "(?, ?)").join(", ")}`,
        parentRows.flat(),
      );
    }
    await transaction.run("UPDATE scan_state SET last_rowid = ? WHERE id = 1", [lastRowId]);
    return true;
  });
}

export function readPendingCoverage(
  cache: SqlDatabase,
  limit: number,
): Promise<{ country_id: string; parent_id: string }[]> {
  return cache.all(
    "SELECT country_id, parent_id FROM country_parents WHERE covered_km2 IS NULL LIMIT ?",
    [limit],
  );
}

/** A no-op if a reset removed the row while the area was being computed. */
export async function saveCoverage(
  cache: SqlDatabase,
  countryId: string,
  parentId: string,
  coveredKm2: number,
): Promise<void> {
  await cache.run(
    "UPDATE country_parents SET covered_km2 = ? WHERE country_id = ? AND parent_id = ?",
    [coveredKm2, countryId, parentId],
  );
}

/** Visited countries as far as scanned; a percentage is partial while coverage is pending. */
export async function readCachedCountrySummary(
  cache: SqlDatabase,
  countries: ReadonlyMap<string, CountryProperties>,
): Promise<CountryVisit[]> {
  const rows = await cache.all<{
    country_id: string;
    first_seen_at_ms: number;
    covered_km2: number;
    pending: number;
  }>(`
    SELECT v.country_id, v.first_seen_at_ms,
      COALESCE(SUM(p.covered_km2), 0) AS covered_km2,
      COALESCE(SUM(p.parent_id IS NOT NULL AND p.covered_km2 IS NULL), 0) AS pending
    FROM country_visits v
    LEFT JOIN country_parents p ON p.country_id = v.country_id
    GROUP BY v.country_id
  `);
  return rows.flatMap((row) => {
    const country = countries.get(row.country_id);
    if (!country) return [];
    return [{
      ...country,
      firstSeenAtMs: row.first_seen_at_ms,
      exploredAreaKm2: row.covered_km2,
      uncoveredPercent: Math.min(100, country.areaKm2 > 0 ? row.covered_km2 / country.areaKm2 * 100 : 0),
      coveragePending: row.pending > 0,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
