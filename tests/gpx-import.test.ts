import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importGpxText } from "../src/data/gpx-import";
import { readAllSamplePoints } from "../src/data/location-sample-repository";
import { runMigrations } from "../src/data/migrations";
import { SqliteYonderRepository } from "../src/data/yonder-repository";
import { formatGpx } from "../src/domain/gpx";
import { H3HexGrid } from "../src/domain/hex-grid";
import { YonderIngestionService } from "../src/domain/ingest-location";

import { deriveAllTiles } from "./support/derive-all-tiles";
import { NodeSqliteDatabase } from "./support/node-sqlite-database";

const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => kv.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { kv.set(key, value); },
  },
}));


type CountRow = { count: number };

// A synthetic walk: 30 points, 40 m apart, one every 30 seconds.
function syntheticWalk(count = 30): string {
  const start = Date.parse("2026-03-01T08:00:00Z");
  const points = Array.from({ length: count }, (_, index) => ({
    latitude: 10 + index * 0.00036,
    longitude: 20,
    recordedAtMs: start + index * 30_000,
  }));
  return formatGpx(points);
}

describe("importGpxText", () => {
  let database: NodeSqliteDatabase;
  let service: YonderIngestionService;
  const count = async (table: string) =>
    (await database.first<CountRow>(`SELECT COUNT(*) AS count FROM ${table}`))?.count;

  beforeEach(async () => {
    kv.clear();
    database = new NodeSqliteDatabase();
    await runMigrations(database);
    service = new YonderIngestionService(new SqliteYonderRepository(database), new H3HexGrid());
  });

  afterEach(() => {
    database.close();
  });

  it("adds points as imported history, leaving their tiles to the background deriver", async () => {
    const result = await importGpxText(syntheticWalk(), { database });

    expect(result).toEqual({ pointCount: 30, addedPointCount: 30, alreadyStoredCount: 0, skippedCount: 0 });
    expect(await count("unlocked_cells")).toBe(0);
    const { addedTileCount } = await deriveAllTiles(database);
    expect(addedTileCount).toBeGreaterThan(20);
    expect(await count("unlocked_cells")).toBe(addedTileCount);
    const sources = await database.all<{ source: string }>("SELECT DISTINCT source FROM location_samples");
    expect(sources).toEqual([{ source: "external-import" }]);
  });

  it("adds nothing when the same file is imported again", async () => {
    await importGpxText(syntheticWalk(), { database });
    const again = await importGpxText(syntheticWalk(), { database });

    expect(again).toMatchObject({ addedPointCount: 0, alreadyStoredCount: 30 });
    expect(await count("location_samples")).toBe(30);
  });

  it("does not duplicate live points when Yonder's own export is imported", async () => {
    await service.ingest([
      { source: "live-foreground", recordedAt: "2026-03-01T08:00:00.000Z", latitude: 10.123456789, longitude: 20.987654321, horizontalAccuracyM: 6.5 },
      { source: "live-background", recordedAt: "2026-03-01T08:01:00.000Z", latitude: 10.124, longitude: 20.988, horizontalAccuracyM: 12 },
    ]);
    const exported = formatGpx(await readAllSamplePoints(database));

    const result = await importGpxText(exported, { database });

    expect(result).toMatchObject({ pointCount: 2, addedPointCount: 0, alreadyStoredCount: 2 });
    expect(await count("location_samples")).toBe(2);
  });

  it("imports points with any accuracy, unlike live readings", async () => {
    const gpx = `<gpx><trk><trkseg><trkpt lat="10" lon="20"><time>2026-03-01T08:00:00Z</time>
<extensions><yonder:accuracy>400</yonder:accuracy></extensions></trkpt></trkseg></trk></gpx>`;
    const result = await importGpxText(gpx, { database });

    expect(result).toMatchObject({ addedPointCount: 1 });
    expect(await deriveAllTiles(database)).toMatchObject({ addedTileCount: 1 });
    expect(await readAllSamplePoints(database)).toEqual([
      { latitude: 10, longitude: 20, recordedAtMs: Date.parse("2026-03-01T08:00:00Z"), horizontalAccuracyM: 400 },
    ]);
  });

  it("counts points without a time or with an impossible position as skipped", async () => {
    const gpx = `<gpx><trk><trkseg>
<trkpt lat="10" lon="20"/>
<trkpt lat="95" lon="20"><time>2026-03-01T08:00:00Z</time></trkpt>
<trkpt lat="10" lon="20"><time>2026-02-30T08:00:00Z</time></trkpt>
<trkpt lat="10" lon="20"><time>2026-03-01T08:00:00Z</time></trkpt>
</trkseg></trk></gpx>`;
    const result = await importGpxText(gpx, { database });

    expect(result).toMatchObject({ pointCount: 3, addedPointCount: 1, skippedCount: 3 });
  });

  it("reports progress per chunk", async () => {
    const progress: [number, number][] = [];
    await importGpxText(syntheticWalk(12_000), {
      database,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([[5_000, 12_000], [10_000, 12_000], [12_000, 12_000]]);
  });
});
