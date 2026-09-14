import { area } from "@turf/area";
import { cellToChildren, cellToParent, gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";

import { readCountrySummary } from "../src/data/country-summary";
import { runMigrations } from "../src/data/migrations";
import { CountryCoverageAccumulator, CountryIndex, formatUncoveredPercent, type CountryCollection, type CountryFeature } from "../src/domain/country-coverage";

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

describe("country coverage", () => {
  it("counts a large hex once, preserves first visit, and uses its clipped area", () => {
    const index = new CountryIndex(collection([country]));
    const summary = new CountryCoverageAccumulator(index);
    summary.add(cell, 200);
    summary.add(cell, 100);
    for (const sibling of gridDisk(cell, 1)) summary.add(sibling, 300);
    const [visit] = summary.result();
    expect(visit?.firstSeenAtMs).toBe(100);
    expect(visit?.exploredAreaKm2).toBeCloseTo(index.coveredAreaKm2(parent, country.properties.id), 7);
    expect(visit?.exploredAreaKm2).toBeGreaterThan(100);
    expect(visit?.uncoveredPercent).toBeCloseTo(visit!.exploredAreaKm2 / country.properties.areaKm2 * 100);
  });

  it("clips a coarse hex to a tiny country, never counting beyond 100%", () => {
    const tiny = square("Tiny", 19.999, 9.999, 20.001, 10.001);
    const index = new CountryIndex(collection([tiny]));
    const summary = new CountryCoverageAccumulator(index);
    summary.add(cell, 100);
    const visit = summary.result()[0]!;
    expect(visit.uncoveredPercent).toBeCloseTo(100, 4);
    expect(visit.exploredAreaKm2).toBeCloseTo(tiny.properties.areaKm2, 4);
  });

  it("does not mark neighbors visited just because a big hex overlaps them", () => {
    const a = square("A", 19.99, 9.99, 20.01, 10.01);
    const b = square("B", 20.01, 9.99, 20.03, 10.01);
    const summary = new CountryCoverageAccumulator(new CountryIndex(collection([a, b])));
    summary.add(cell, 100);
    expect(summary.result().map(({ id }) => id)).toEqual(["A"]);
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

  it("reads all pages and ignores other persisted resolutions", async () => {
    const db = new NodeSqliteDatabase();
    try {
      await runMigrations(db);
      const children = cellToChildren(cellToParent(cell, 8), 11).slice(0, 300);
      for (const [i, id] of children.entries()) {
        await db.run("INSERT INTO unlocked_cells VALUES (?, 11, 10, 20, ?, ?)", [id, i + 1, i + 1]);
      }
      await db.run("INSERT INTO unlocked_cells VALUES (?, 10, 10, 20, 0, 0)", [cellToParent(cell, 10)]);
      const result = await readCountrySummary(db, new CountryIndex(collection([country])));
      expect(result).toHaveLength(1);
      expect(result?.[0]?.firstSeenAtMs).toBe(1);
      expect(await readCountrySummary(db, new CountryIndex(collection([country])), () => true)).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe("bundled country data", () => {
  const boundaries = require("../src/data/countries/boundaries.json") as CountryCollection;
  const display = require("../src/data/countries/display.json") as CountryCollection;
  const index = new CountryIndex(boundaries);

  it.each([
    [52.52, 13.405, "Germany"], [48.8566, 2.3522, "France"],
    [-16.5, -68.15, "Bolivia"], [41.9029, 12.4534, "Vatican"],
    [43.7384, 7.4246, "Monaco"],
  ])("assigns a synthetic point at %s, %s to %s", (latitude, longitude, name) => {
    expect(index.countryForCell(latLngToCell(latitude as number, longitude as number, 11))?.name).toBe(name);
  });

  it("has matching display IDs, positive areas, and no Antarctic count", () => {
    expect(display.features.map(({ id }) => id)).toEqual(boundaries.features.map(({ id }) => id));
    expect(boundaries.features.every(({ properties }) => properties.areaKm2 > 0)).toBe(true);
    expect(index.countryForCell(latLngToCell(-85, 0, 11))).toBeNull();
  });
});
