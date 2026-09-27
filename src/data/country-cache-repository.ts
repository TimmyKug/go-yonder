import {
  type CountryCollection,
  type CountryProperties,
  type CountryVisit,
  type RegionCollection,
  type RegionProperties,
  type RegionVisit,
} from "../domain/country-coverage";

import type { DatabaseMigration } from "./migrations";
import type { SqlDatabase, SqlExecutor, SqlValue } from "./sql-database";

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
  {
    version: 2,
    name: "create-region-cache",
    sql: `
      CREATE TABLE region_visits (
        region_id TEXT PRIMARY KEY,
        first_seen_at_ms INTEGER NOT NULL
      );

      -- Finer hexes than countries; covered_km2 is NULL until computed.
      CREATE TABLE region_parents (
        region_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        covered_km2 REAL,
        PRIMARY KEY (region_id, parent_id)
      );
    `,
  },
]);

let transactionQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs a transaction on the cache's own connection, one at a time. Expo's
 * exclusive transactions open and close a new connection each time, and the
 * scan commits a page every few milliseconds; that churn is avoided here.
 */
function inCacheTransaction<T>(
  cache: SqlDatabase,
  task: (transaction: SqlExecutor) => Promise<T>,
): Promise<T> {
  const run = transactionQueue.then(async () => {
    await cache.execute("BEGIN IMMEDIATE");
    try {
      const result = await task(cache);
      await cache.execute("COMMIT");
      return result;
    } catch (error: unknown) {
      await cache.execute("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
  transactionQueue = run.catch(() => undefined);
  return run;
}

export type CountryScanState = Readonly<{
  generation: number;
  lastRowId: number;
}>;

export type UnscannedCell = { rowid: number; cell_id: string; first_seen_at_ms: number };

export type ScannedCell = Readonly<{
  countryId: string;
  parentId: string;
  firstSeenAtMs: number;
  /** The cell's region and its finer coverage hex, when it lies in one. */
  region?: Readonly<{ regionId: string; parentId: string }>;
}>;

export type CoverageKind = "country" | "region";

/** Changes whenever the bundled boundaries change, which invalidates the cache. */
export function countryBoundariesFingerprint(
  collection: CountryCollection,
  regions?: RegionCollection,
): string {
  // FNV-1a over every country's and region's identifier and area.
  let hash = 0x811c9dc5;
  const features = [...collection.features, ...(regions?.features ?? [])];
  for (const { properties } of features) {
    const text = `${properties.id}:${properties.areaKm2};`;
    for (let i = 0; i < text.length; i += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
  }
  return `${collection.features.length}:${regions?.features.length ?? 0}:${hash.toString(16)}`;
}

async function clear(cache: SqlDatabase, boundaries: string): Promise<CountryScanState> {
  return inCacheTransaction(cache, async (transaction) => {
    const previous = await transaction.first<{ generation: number }>(
      "SELECT generation FROM scan_state WHERE id = 1",
    );
    const generation = (previous?.generation ?? 0) + 1;
    await transaction.execute(
      "DELETE FROM country_visits; DELETE FROM country_parents; DELETE FROM region_visits; DELETE FROM region_parents",
    );
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
  const regionVisits = new Map<string, number>();
  const regionParents = new Set<string>();
  const regionParentRows: SqlValue[][] = [];
  for (const { countryId, parentId, firstSeenAtMs, region } of cells) {
    visits.set(countryId, Math.min(visits.get(countryId) ?? firstSeenAtMs, firstSeenAtMs));
    const key = `${countryId}:${parentId}`;
    if (!parents.has(key)) {
      parents.add(key);
      parentRows.push([countryId, parentId]);
    }
    if (region) {
      regionVisits.set(region.regionId, Math.min(regionVisits.get(region.regionId) ?? firstSeenAtMs, firstSeenAtMs));
      const regionKey = `${region.regionId}:${region.parentId}`;
      if (!regionParents.has(regionKey)) {
        regionParents.add(regionKey);
        regionParentRows.push([region.regionId, region.parentId]);
      }
    }
  }
  return inCacheTransaction(cache, async (transaction) => {
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
    if (regionVisits.size > 0) {
      await transaction.run(
        `INSERT INTO region_visits (region_id, first_seen_at_ms)
         VALUES ${[...regionVisits].map(() => "(?, ?)").join(", ")}
         ON CONFLICT (region_id) DO UPDATE SET
           first_seen_at_ms = MIN(first_seen_at_ms, excluded.first_seen_at_ms)`,
        [...regionVisits].flat(),
      );
      await transaction.run(
        `INSERT OR IGNORE INTO region_parents (region_id, parent_id)
         VALUES ${regionParentRows.map(() => "(?, ?)").join(", ")}`,
        regionParentRows.flat(),
      );
    }
    await transaction.run("UPDATE scan_state SET last_rowid = ? WHERE id = 1", [lastRowId]);
    return true;
  });
}

const COVERAGE_TABLES = {
  country: { table: "country_parents", id: "country_id" },
  region: { table: "region_parents", id: "region_id" },
} as const;

/** Explored hexes still missing their clipped area; countries come first. */
export async function readPendingCoverage(
  cache: SqlDatabase,
  limit: number,
): Promise<{ kind: CoverageKind; area_id: string; parent_id: string }[]> {
  for (const kind of ["country", "region"] as const) {
    const { table, id } = COVERAGE_TABLES[kind];
    const rows = await cache.all<{ area_id: string; parent_id: string }>(
      `SELECT ${id} AS area_id, parent_id FROM ${table} WHERE covered_km2 IS NULL LIMIT ?`,
      [limit],
    );
    if (rows.length > 0) return rows.map((row) => ({ kind, ...row }));
  }
  return [];
}

/** A no-op if a reset removed the row while the area was being computed. */
export async function saveCoverage(
  cache: SqlDatabase,
  kind: CoverageKind,
  areaId: string,
  parentId: string,
  coveredKm2: number,
): Promise<void> {
  const { table, id } = COVERAGE_TABLES[kind];
  await cache.run(
    `UPDATE ${table} SET covered_km2 = ? WHERE ${id} = ? AND parent_id = ?`,
    [coveredKm2, areaId, parentId],
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

/** Visited regions as far as scanned; a percentage is partial while coverage is pending. */
export async function readCachedRegionSummary(
  cache: SqlDatabase,
  regions: ReadonlyMap<string, RegionProperties>,
): Promise<RegionVisit[]> {
  const rows = await cache.all<{
    region_id: string;
    first_seen_at_ms: number;
    covered_km2: number;
    pending: number;
  }>(`
    SELECT v.region_id, v.first_seen_at_ms,
      COALESCE(SUM(p.covered_km2), 0) AS covered_km2,
      COALESCE(SUM(p.parent_id IS NOT NULL AND p.covered_km2 IS NULL), 0) AS pending
    FROM region_visits v
    LEFT JOIN region_parents p ON p.region_id = v.region_id
    GROUP BY v.region_id
  `);
  return rows.flatMap((row) => {
    const region = regions.get(row.region_id);
    if (!region) return [];
    return [{
      ...region,
      firstSeenAtMs: row.first_seen_at_ms,
      exploredAreaKm2: row.covered_km2,
      uncoveredPercent: Math.min(100, region.areaKm2 > 0 ? row.covered_km2 / region.areaKm2 * 100 : 0),
      coveragePending: row.pending > 0,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
