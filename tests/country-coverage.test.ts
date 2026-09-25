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
  resetCountryCache,
} from "../src/data/country-cache-repository";
import { runMigrations } from "../src/data/migrations";
import { CountryIndex, formatUncoveredPercent, type CountryCollection, type CountryFeature } from "../src/domain/country-coverage";

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

  it("discards a page scanned before a reset instead of mixing generations", async () => {
    const { main, cache } = await databases();
    for (const id of children.slice(0, 5)) await unlock(main, id);
    const state = await prepareCountryCache(cache, main, "b");
    await resetCountryCache(cache);
    expect(await commitScannedCells(cache, state.generation, 5, [{ countryId: "Testland", parentId: parent, firstSeenAtMs: 1 }])).toBe(false);
    expect(await cache.all("SELECT * FROM country_visits")).toEqual([]);
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
