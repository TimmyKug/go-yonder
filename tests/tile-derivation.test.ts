import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importGpxText } from "../src/data/gpx-import";
import { runMigrations } from "../src/data/migrations";
import { ensureTileCursor, readTileCursor } from "../src/data/tile-cursor";
import { deriveTilesAfter } from "../src/data/tile-derivation-repository";
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

// Synthetic walks with pauses: repeated positions, like a phone standing still.
function syntheticPoints(count: number) {
  const start = Date.UTC(2026, 2, 1);
  return Array.from({ length: count }, (_, index) => ({
    latitude: 10 + Math.floor(index / 3) * 0.0002,
    longitude: 20 + (index % 7) * 0.0001,
    recordedAtMs: start + index * 20_000,
  }));
}

const tiles = (db: NodeSqliteDatabase) =>
  db.all("SELECT cell_id, first_seen_at_ms, last_seen_at_ms FROM unlocked_cells ORDER BY cell_id");

describe("background tile derivation", () => {
  const databases: NodeSqliteDatabase[] = [];
  async function database() {
    const db = new NodeSqliteDatabase();
    databases.push(db);
    await runMigrations(db);
    return db;
  }
  beforeEach(() => kv.clear());
  afterEach(() => databases.splice(0).forEach((db) => db.close()));

  it("resumes after an interruption and ends with the tiles live tracking would unlock", async () => {
    const points = syntheticPoints(3_000);
    const imported = await database();
    await importGpxText(formatGpx(points), { database: imported });

    // One step, then the app is closed; the next run continues from the cursor.
    const first = await deriveTilesAfter(imported, readTileCursor()!, 1_000);
    kv.set("tile-derivation-cursor", String(first.cursor));
    await deriveAllTiles(imported, 1_000);
    expect(readTileCursor()).toBe(3_000);

    const live = await database();
    await new YonderIngestionService(new SqliteYonderRepository(live), new H3HexGrid()).ingest(
      points.map((point) => ({
        source: "live-foreground",
        recordedAt: new Date(point.recordedAtMs).toISOString(),
        latitude: point.latitude,
        longitude: point.longitude,
        horizontalAccuracyM: 5,
      })),
    );
    expect(await tiles(imported)).toEqual(await tiles(live));
  });

  it("starts after the samples that already have tiles", async () => {
    const db = await database();
    await new YonderIngestionService(new SqliteYonderRepository(db), new H3HexGrid()).ingest([
      { source: "live-foreground", recordedAt: "2026-03-01T00:00:00Z", latitude: 1, longitude: 1, horizontalAccuracyM: 5 },
    ]);
    expect(await ensureTileCursor(db)).toBe(1);
    expect(await deriveAllTiles(db)).toEqual({ addedTileCount: 0, cursor: 1 });
  });
});
