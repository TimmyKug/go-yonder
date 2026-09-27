import { area } from "@turf/area";
import { cellToChildren, cellToParent, gridDisk, latLngToCell } from "h3-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { scanCountries } from "../src/countries/country-scan";
import {
  commitScannedCells,
  COUNTRY_CACHE_MIGRATIONS,
  countryBoundariesFingerprint,
  prepareCountryCache,
  readCachedCountrySummary,
  readCachedRegionSummary,
  resetCountryCache,
} from "../src/data/country-cache-repository";
import { runMigrations } from "../src/data/migrations";
import {
  AreaIndex,
  CountryIndex,
  formatUncoveredPercent,
  REGION_COVERAGE_RESOLUTION,
  type CountryCollection,
  type CountryFeature,
  type RegionCollection,
  type RegionProperties,
} from "../src/domain/country-coverage";

import { NodeSqliteDatabase } from "./support/node-sqlite-database";

function square(id: string, west: number, south: number, east: number, north: number): CountryFeature {
  const feature: CountryFeature = {
    type: "Feature", id, properties: { id, name: id, areaKm2: 0 },
    geometry: { type: "MultiPolygon", coordinates: [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]] },
  };
  feature.properties.areaKm2 = area(feature) / 1e6;
  return feature;
}
const cell = latLngToCell(10, 20, 11);
const parent = cellToParent(cell, 4);
const country = square("Testland", 19, 9, 21, 11);
const collection = (features: CountryFeature[]): CountryCollection => ({ type: "FeatureCollection", features });

type Db = NodeSqliteDatabase;
const opened: Db[] = [];
afterEach(() => opened.splice(0).forEach((db) => db.close()));
async function databases() {
  const main = new NodeSqliteDatabase();
  const cache = new NodeSqliteDatabase();
  opened.push(main, cache);
  await runMigrations(main);
  await runMigrations(cache, COUNTRY_CACHE_MIGRATIONS);
  return { main, cache };
}
async function unlock(main: Db, id: string, firstSeenAtMs = 100, resolution = 11) {
  await main.run("INSERT INTO unlocked_cells VALUES (?, ?, 10, 20, ?, ?)", [id, resolution, firstSeenAtMs, firstSeenAtMs]);
}
const noPause = { pause: async () => undefined, onProgress: () => undefined };
async function scan(main: Db, cache: Db, features: CountryFeature[], shouldContinue = () => true) {
  const countries = collection(features);
  const index = new CountryIndex(countries);
  const done = await scanCountries(main, cache, index, countryBoundariesFingerprint(countries), { ...noPause, shouldContinue });
  const summary = await readCachedCountrySummary(cache, new Map(features.map(({ properties }) => [properties.id, properties])));
  return { done, summary, index };
}

describe("country coverage", () => {
  it("counts a large hex once, preserves first visit, and uses its clipped area", async () => {
    const { main, cache } = await databases();
    await unlock(main, cell, 200);
    for (const sibling of gridDisk(cell, 1)) if (sibling !== cell) await unlock(main, sibling, 300);
    await main.run("UPDATE unlocked_cells SET first_seen_at_ms = 100 WHERE cell_id = ?", [cell]);
    const { done, summary: [visit], index } = await scan(main, cache, [country]);
    expect(done).toBe(true);
    expect(visit?.firstSeenAtMs).toBe(100);
    expect(visit?.coveragePending).toBe(false);
    expect(visit?.exploredAreaKm2).toBeCloseTo(index.coveredAreaKm2(parent, country.properties.id), 7);
    expect(visit?.exploredAreaKm2).toBeGreaterThan(100);
    expect(visit?.uncoveredPercent).toBeCloseTo(visit!.exploredAreaKm2 / country.properties.areaKm2 * 100);
  });

  it("clips a coarse hex to a tiny country, never counting beyond 100%", async () => {
    const { main, cache } = await databases();
    const tiny = square("Tiny", 19.999, 9.999, 20.001, 10.001);
    await unlock(main, cell);
    const visit = (await scan(main, cache, [tiny])).summary[0]!;
    expect(visit.uncoveredPercent).toBeCloseTo(100, 4);
    expect(visit.exploredAreaKm2).toBeCloseTo(tiny.properties.areaKm2, 4);
  });

  it("does not mark neighbors visited just because a big hex overlaps them", async () => {
    const { main, cache } = await databases();
    const a = square("A", 19.99, 9.99, 20.01, 10.01);
    const b = square("B", 20.01, 9.99, 20.03, 10.01);
    await unlock(main, cell);
    expect((await scan(main, cache, [a, b])).summary.map(({ id }) => id)).toEqual(["A"]);
  });

  it("excludes ocean cells and polygon holes", () => {
    const withHole = square("Holeland", 19, 9, 21, 11);
    withHole.geometry.coordinates[0]!.push([[19.9, 9.9], [19.9, 10.1], [20.1, 10.1], [20.1, 9.9], [19.9, 9.9]]);
    const index = new CountryIndex(collection([withHole]));
    expect(index.countryForCell(cell)).toBeNull();
    expect(index.countryForCell(latLngToCell(-30, -30, 11))).toBeNull();
  });

  it("handles dateline-crossing coarse hexes", () => {
    const a = square("East", 179.8, 9.8, 180, 10.2);
    const b = square("West", -180, 9.8, -179.8, 10.2);
    const index = new CountryIndex(collection([a, b]));
    for (const longitude of [179.999, -179.999]) {
      const id = latLngToCell(10, longitude, 11);
      const assigned = index.countryForCell(id)!;
      const covered = index.coveredAreaKm2(cellToParent(id, 4), assigned.id);
      expect(covered).toBeGreaterThan(0);
      expect(covered).toBeLessThanOrEqual(assigned.areaKm2 + 0.001);
    }
  });

  it("formats small percentages without pretending they are zero", () => {
    expect([0, 0.001, 0.01, 1.25, 10, 99.999, 100].map(formatUncoveredPercent))
      .toEqual(["0%", "<0.01%", "0.01%", "1.25%", "10%", ">99.99%", "100%"]);
  });
});

describe("background country scan", () => {
  const children = cellToChildren(cellToParent(cell, 8), 11).slice(0, 300);

  it("reads all pages and ignores other persisted resolutions", async () => {
    const { main, cache } = await databases();
    for (const [i, id] of children.entries()) await unlock(main, id, i + 1);
    await unlock(main, cellToParent(cell, 10), 0, 10);
    const { summary } = await scan(main, cache, [country]);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.firstSeenAtMs).toBe(1);
  });

  it("shows a visited country before its coverage is computed, then resumes where it stopped", async () => {
    const { main, cache } = await databases();
    for (const [i, id] of children.entries()) await unlock(main, id, i + 1);
    let pages = 0;
    const partial = await scan(main, cache, [country], () => pages++ < 1);
    expect(partial.done).toBe(false);
    expect(partial.summary).toEqual([expect.objectContaining({ id: "Testland", coveragePending: true, firstSeenAtMs: 1 })]);

    const index = new CountryIndex(collection([country]));
    const assign = vi.spyOn(index, "countryForCell");
    const done = await scanCountries(main, cache, index, countryBoundariesFingerprint(collection([country])),
      { ...noPause, shouldContinue: () => true });
    expect(done).toBe(true);
    expect(assign).toHaveBeenCalledTimes(300 - 128);
    const resumed = await readCachedCountrySummary(cache, new Map([[country.properties.id, country.properties]]));

    const fresh = await databases();
    for (const [i, id] of children.entries()) await unlock(fresh.main, id, i + 1);
    expect(resumed).toEqual((await scan(fresh.main, fresh.cache, [country])).summary);
  });

  it("processes only cells unlocked since the last scan", async () => {
    const { main, cache } = await databases();
    for (const id of children.slice(0, 10)) await unlock(main, id);
    await scan(main, cache, [country]);
    for (const id of children.slice(10, 13)) await unlock(main, id, 50);
    const index = new CountryIndex(collection([country]));
    const assign = vi.spyOn(index, "countryForCell");
    await scanCountries(main, cache, index, countryBoundariesFingerprint(collection([country])),
      { ...noPause, shouldContinue: () => true });
    expect(assign).toHaveBeenCalledTimes(3);
    const summary = await readCachedCountrySummary(cache, new Map([[country.properties.id, country.properties]]));
    expect(summary[0]?.firstSeenAtMs).toBe(50);
  });

  it("starts over after a reset, when the boundaries change, or when the cells were replaced", async () => {
    const { main, cache } = await databases();
    const other = square("Otherland", 19, 9, 21, 11);
    for (const id of children.slice(0, 5)) await unlock(main, id);
    await scan(main, cache, [country]);

    await resetCountryCache(cache);
    expect(await readCachedCountrySummary(cache, new Map([[country.properties.id, country.properties]]))).toEqual([]);
    expect((await scan(main, cache, [country])).summary).toHaveLength(1);

    expect((await scan(main, cache, [other])).summary.map(({ id }) => id)).toEqual(["Otherland"]);

    const replaced = await databases();
    await unlock(replaced.main, children[0]!);
    const index = new CountryIndex(collection([other]));
    const assign = vi.spyOn(index, "countryForCell");
    await scanCountries(replaced.main, cache, index, countryBoundariesFingerprint(collection([other])),
      { ...noPause, shouldContinue: () => true });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("keeps every cache transaction on the cache's own connection, one at a time", async () => {
    const { main, cache } = await databases();
    for (const id of children) await unlock(main, id);
    const noNewConnections = Object.assign(Object.create(Object.getPrototypeOf(cache)), cache, {
      withExclusiveTransaction: () => { throw new Error("opened a new connection"); },
    }) as NodeSqliteDatabase;
    const { done } = await scan(main, noNewConnections, [country]);
    expect(done).toBe(true);

    const state = await prepareCountryCache(noNewConnections, main, "b");
    const [committed] = await Promise.all([
      commitScannedCells(noNewConnections, state.generation, 1, [{ countryId: "Testland", parentId: parent, firstSeenAtMs: 1 }]),
      resetCountryCache(noNewConnections),
    ]);
    expect(committed).toBe(true);
    expect(await cache.all("SELECT * FROM country_visits")).toEqual([]);
  });

  it("discards a page scanned before a reset instead of mixing generations", async () => {
    const { main, cache } = await databases();
    for (const id of children.slice(0, 5)) await unlock(main, id);
    const state = await prepareCountryCache(cache, main, "b");
    await resetCountryCache(cache);
    expect(await commitScannedCells(cache, state.generation, 5, [{ countryId: "Testland", parentId: parent, firstSeenAtMs: 1 }])).toBe(false);
    expect(await cache.all("SELECT * FROM country_visits")).toEqual([]);
  });
});

describe("regions", () => {
  // Testland split into a west and an east region, and a region of another country.
  const region = (id: string, countryId: string, west: number, east: number) => {
    const { geometry, properties } = square(id, west, 9, east, 11);
    return { type: "Feature" as const, id, geometry, properties: { ...properties, countryId } as RegionProperties };
  };
  const regions: RegionCollection = {
    type: "FeatureCollection",
    features: [region("West", "Testland", 19, 20), region("East", "Testland", 20, 21), region("Elsewhere", "Otherland", 30, 31)],
  };
  const regionMap = new Map(regions.features.map(({ properties }) => [properties.id, properties]));
  const westCell = latLngToCell(10, 19.5, 11);

  it("records the region of each visited cell with its own finer coverage", async () => {
    const { main, cache } = await databases();
    await unlock(main, westCell, 500);
    await unlock(main, latLngToCell(10, 19.51, 11), 400);
    const countries = collection([country]);
    const done = await scanCountries(main, cache, new CountryIndex(countries),
      countryBoundariesFingerprint(countries, regions), { ...noPause, shouldContinue: () => true }, new AreaIndex(regions));

    expect(done).toBe(true);
    const [west] = await readCachedRegionSummary(cache, regionMap);
    expect(west).toMatchObject({ id: "West", countryId: "Testland", firstSeenAtMs: 400, coveragePending: false });
    // One resolution-6 hex, about 36 km², clipped to a region of about 24,000 km².
    const parents = await cache.all<{ parent_id: string }>("SELECT parent_id FROM region_parents");
    expect(parents).toEqual([{ parent_id: cellToParent(westCell, REGION_COVERAGE_RESOLUTION) }]);
    expect(west!.exploredAreaKm2).toBeGreaterThan(20);
    expect(west!.exploredAreaKm2).toBeLessThan(50);
    expect(west!.uncoveredPercent).toBeCloseTo(west!.exploredAreaKm2 / west!.areaKm2 * 100);
    expect(await readCachedRegionSummary(cache, regionMap)).toHaveLength(1);
  });

  it("ignores a region that belongs to a different country than the cell", async () => {
    const { main, cache } = await databases();
    await unlock(main, westCell);
    const countries = collection([country]);
    const misplaced: RegionCollection = { type: "FeatureCollection", features: [region("Foreign", "Otherland", 19, 20)] };
    await scanCountries(main, cache, new CountryIndex(countries),
      countryBoundariesFingerprint(countries, misplaced), { ...noPause, shouldContinue: () => true }, new AreaIndex(misplaced));

    expect(await cache.all("SELECT * FROM region_visits")).toEqual([]);
    expect(await cache.all("SELECT country_id FROM country_visits")).toEqual([{ country_id: "Testland" }]);
  });

  it("forgets regions on reset and rescans when the region borders change", async () => {
    const { main, cache } = await databases();
    await unlock(main, westCell);
    const countries = collection([country]);
    const fingerprint = countryBoundariesFingerprint(countries, regions);
    await scanCountries(main, cache, new CountryIndex(countries), fingerprint, { ...noPause, shouldContinue: () => true }, new AreaIndex(regions));
    await resetCountryCache(cache);
    expect(await cache.all("SELECT * FROM region_visits")).toEqual([]);
    expect(await cache.all("SELECT * FROM region_parents")).toEqual([]);
    expect(countryBoundariesFingerprint(countries)).not.toBe(fingerprint);
  });
});

describe("bundled country data", () => {
  const countries = require("../src/data/countries/countries.json") as CountryCollection;
  const index = new CountryIndex(countries);

  it.each([
    [52.52, 13.405, "Germany"], [48.8566, 2.3522, "France"],
    [-16.5, -68.15, "Bolivia"], [41.9029, 12.4534, "Vatican"],
    [43.7384, 7.4246, "Monaco"],
  ])("assigns a synthetic point at %s, %s to %s", (latitude, longitude, name) => {
    expect(index.countryForCell(latLngToCell(latitude as number, longitude as number, 11))?.name).toBe(name);
  });

  it("has positive areas and no Antarctic count", () => {
    expect(countries.features.every(({ properties }) => properties.areaKm2 > 0)).toBe(true);
    expect(index.countryForCell(latLngToCell(-85, 0, 11))).toBeNull();
  });
});

describe("bundled region data", () => {
  const countries = require("../src/data/countries/countries.json") as CountryCollection;
  const regions = require("../src/data/regions/regions.json") as RegionCollection;
  const countryIndex = new CountryIndex(countries);
  const regionIndex = new AreaIndex(regions);

  it.each([
    [52.52, 13.405, "Berlin"], [48.137, 11.575, "Bavaria"], [48.8566, 2.3522, "Paris"],
    [47.3769, 8.5417, "Zürich"], [40.7128, -74.006, "New York"], [34.05, -118.25, "California"],
  ])("assigns a synthetic point at %s, %s to %s, inside the same country", (latitude, longitude, name) => {
    const cellId = latLngToCell(latitude as number, longitude as number, 11);
    const region = regionIndex.areaForCell(cellId);
    expect(region?.name).toBe(name);
    expect(region?.countryId).toBe(countryIndex.countryForCell(cellId)?.id);
  });

  it("gives every region a bundled country, a unique id and a positive area", () => {
    const countryIds = new Set(countries.features.map(({ properties }) => properties.id));
    const ids = new Set(regions.features.map(({ properties }) => properties.id));
    expect(ids.size).toBe(regions.features.length);
    expect(regions.features.every(({ properties }) => countryIds.has(properties.countryId) && properties.areaKm2 > 0)).toBe(true);
  });
});
