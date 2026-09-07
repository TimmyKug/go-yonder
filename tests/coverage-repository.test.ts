import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../src/data/migrations";
import { SqliteYonderRepository } from "../src/data/yonder-repository";
import { H3HexGrid } from "../src/domain/hex-grid";
import { YonderIngestionService } from "../src/domain/ingest-location";
import type { NormalizedLocationSample } from "../src/domain/location-sample";

import { NodeSqliteDatabase } from "./support/node-sqlite-database";

type CountRow = { count: number };

function sample(
  overrides: Partial<NormalizedLocationSample> = {},
): NormalizedLocationSample {
  return {
    source: "live-foreground",
    recordedAt: "2026-01-01T00:00:00.000Z",
    latitude: 10,
    longitude: 20,
    horizontalAccuracyM: 8,
    ...overrides,
  };
}

describe("SqliteYonderRepository", () => {
  let database: NodeSqliteDatabase;
  let repository: SqliteYonderRepository;
  let service: YonderIngestionService;

  beforeEach(async () => {
    database = new NodeSqliteDatabase();
    await database.execute("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    repository = new SqliteYonderRepository(database);
    service = new YonderIngestionService(repository, new H3HexGrid());
  });

  afterEach(() => {
    database.close();
  });

  it("atomically inserts unique samples and maintains a cell's full time range", async () => {
    const later = sample({ recordedAt: "2026-01-01T00:05:00.000Z" });
    const earlier = sample({ recordedAt: "2025-12-31T23:55:00.000Z" });
    const inaccurate = sample({
      recordedAt: "2026-01-01T00:10:00.000Z",
      horizontalAccuracyM: 51,
    });

    const first = await service.ingest([later, earlier, inaccurate]);
    const replay = await service.ingest([earlier]);
    const cells = await repository.listUnlockedCells({
      south: 9,
      north: 11,
      west: 19,
      east: 21,
    });

    expect(first).toMatchObject({
      receivedCount: 3,
      acceptedCount: 2,
      rejectedCount: 1,
      insertedSampleCount: 2,
      duplicateSampleCount: 0,
      insertedCellCount: 1,
      updatedCellCount: 1,
    });
    expect(first.rejections[0]?.errors[0]?.code).toBe("accuracy-too-low");
    expect(replay).toMatchObject({
      acceptedCount: 1,
      insertedSampleCount: 0,
      duplicateSampleCount: 1,
      insertedCellCount: 0,
      updatedCellCount: 0,
    });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      firstSeenAtMs: Date.parse(earlier.recordedAt),
      lastSeenAtMs: Date.parse(later.recordedAt),
    });

    const sampleCount = await database.first<CountRow>(
      "SELECT COUNT(*) AS count FROM location_samples",
    );
    expect(sampleCount?.count).toBe(2);
  });

  it("rolls back every write when any observation violates a foreign key", async () => {
    await expect(
      service.ingest([
        sample(),
        sample({
          source: "external-import",
          sourceRecordId: "external-1",
          importBatchId: "not-created",
          recordedAt: "2026-01-01T00:01:00.000Z",
        }),
      ]),
    ).rejects.toThrow();

    const samples = await database.first<CountRow>(
      "SELECT COUNT(*) AS count FROM location_samples",
    );
    const cells = await database.first<CountRow>(
      "SELECT COUNT(*) AS count FROM unlocked_cells",
    );
    expect(samples?.count).toBe(0);
    expect(cells?.count).toBe(0);
  });

  it("queries both sides of an antimeridian-crossing viewport", async () => {
    await service.ingest([
      sample({ longitude: 179.95 }),
      sample({
        longitude: -179.95,
        recordedAt: "2026-01-01T00:01:00.000Z",
      }),
      sample({
        longitude: 0,
        recordedAt: "2026-01-01T00:02:00.000Z",
      }),
    ]);

    const crossing = await repository.listUnlockedCells({
      south: 9,
      north: 11,
      west: 179.8,
      east: -179.8,
    });
    const eastOnly = await repository.listUnlockedCells({
      south: 9,
      north: 11,
      west: 179.8,
      east: 180,
    });

    expect(crossing.map(({ centerLongitude }) => centerLongitude).sort()).toEqual([
      expect.closeTo(-179.95, 2),
      expect.closeTo(179.95, 2),
    ]);
    expect(eastOnly).toHaveLength(1);
    expect(eastOnly[0]?.centerLongitude).toBeGreaterThan(179.8);
  });

  it("validates viewport bounds and filters on the persisted resolution", async () => {
    await service.ingest([sample()]);

    await expect(
      repository.listUnlockedCells({ south: 20, north: 10, west: 0, east: 1 }),
    ).rejects.toThrow(/latitude bounds/);

    const otherResolution = await repository.listUnlockedCells(
      { south: -90, north: 90, west: -180, east: 180 },
      10,
    );
    expect(otherResolution).toEqual([]);
  });
});
