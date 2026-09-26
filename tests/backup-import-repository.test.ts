import { latLngToCell } from "h3-js";
import { afterEach, describe, expect, it } from "vitest";

import { importBackupSamples } from "@/src/data/backup-import-repository";
import { runMigrations } from "@/src/data/migrations";
import { validateNormalizedLocationSample } from "@/src/domain/location-sample";

import { NodeSqliteDatabase } from "./support/node-sqlite-database";

const databases: NodeSqliteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

async function database() {
  const db = new NodeSqliteDatabase();
  databases.push(db);
  await runMigrations(db);
  return db;
}

async function addSample(db: NodeSqliteDatabase, recordedAt: string, latitude: number,
  options: { source?: string; sourceRecordId?: string; horizontalAccuracyM?: number; importBatchId?: string } = {}) {
  const validated = validateNormalizedLocationSample({
    source: options.source ?? "external-import", recordedAt, latitude, longitude: 0,
    sourceRecordId: options.sourceRecordId, horizontalAccuracyM: options.horizontalAccuracyM,
  }, {});
  if (!validated.accepted) throw new Error("invalid synthetic sample");
  const sample = validated.sample;
  await db.run(`INSERT INTO location_samples (source, source_record_id, recorded_at_ms, latitude,
    longitude, horizontal_accuracy_m, import_batch_id, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [sample.source, sample.sourceRecordId ?? null, sample.recordedAtMs, sample.latitude, sample.longitude,
    sample.horizontalAccuracyM ?? null, options.importBatchId ?? null, sample.fingerprint]);
  return sample;
}

const cells = (db: NodeSqliteDatabase) =>
  db.all<{ cell_id: string; first_seen_at_ms: number; last_seen_at_ms: number }>(
    "SELECT cell_id, first_seen_at_ms, last_seen_at_ms FROM unlocked_cells ORDER BY cell_id");

describe("GPS-only backup import", () => {
  it("imports points, derives their tiles and ignores the backup's stored tiles", async () => {
    const source = await database();
    const target = await database();
    await addSample(source, "2026-01-01T00:00:00.000Z", 1);
    await addSample(source, "2026-01-02T00:00:00.000Z", 1);
    await addSample(source, "2026-01-03T00:00:00.000Z", 2, { sourceRecordId: "synthetic-visit", horizontalAccuracyM: 6.5 });
    // A stored tile with no point behind it is not imported.
    await source.run("INSERT INTO unlocked_cells VALUES (?, 11, 0, 0, 1, 2)", [latLngToCell(40, 40, 11)]);

    expect(await importBackupSamples(source, target)).toEqual({
      addedTileCount: 2, addedPointCount: 3, totalPointCount: 3, skippedPointCount: 0,
    });
    expect(await cells(target)).toEqual([
      { cell_id: latLngToCell(1, 0, 11), first_seen_at_ms: Date.UTC(2026, 0, 1), last_seen_at_ms: Date.UTC(2026, 0, 2) },
      { cell_id: latLngToCell(2, 0, 11), first_seen_at_ms: Date.UTC(2026, 0, 3), last_seen_at_ms: Date.UTC(2026, 0, 3) },
    ].sort((a, b) => a.cell_id.localeCompare(b.cell_id)));
    const restored = await target.first("SELECT source_record_id, horizontal_accuracy_m FROM location_samples WHERE latitude = 2");
    expect(restored).toEqual({ source_record_id: "synthetic-visit", horizontal_accuracy_m: 6.5 });
  });

  it("keeps local history, widens visit windows and writes nothing when reimported", async () => {
    const source = await database();
    const target = await database();
    await addSample(target, "2026-01-05T00:00:00.000Z", 1);
    await target.run("INSERT INTO unlocked_cells VALUES (?, 11, 1, 0, ?, ?)",
      [latLngToCell(1, 0, 11), Date.UTC(2026, 0, 5), Date.UTC(2026, 0, 5)]);
    await addSample(source, "2026-01-05T00:00:00.000Z", 1);
    await addSample(source, "2026-01-01T00:00:00.000Z", 1);

    expect(await importBackupSamples(source, target)).toMatchObject({ addedTileCount: 0, addedPointCount: 1 });
    expect(await cells(target)).toEqual([
      { cell_id: latLngToCell(1, 0, 11), first_seen_at_ms: Date.UTC(2026, 0, 1), last_seen_at_ms: Date.UTC(2026, 0, 5) },
    ]);
    const before = await target.all("SELECT * FROM location_samples ORDER BY id");
    expect(await importBackupSamples(source, target)).toEqual({
      addedTileCount: 0, addedPointCount: 0, totalPointCount: 2, skippedPointCount: 0,
    });
    expect(await target.all("SELECT * FROM location_samples ORDER BY id")).toEqual(before);
  });

  it("restores live points above the current accuracy limit and recomputes fingerprints", async () => {
    const source = await database();
    const target = await database();
    await source.run(`INSERT INTO import_batches
      (id, source_type, file_name, file_hash, parser_version, status, created_at_ms)
      VALUES ('other-device-batch', 'provider', 'source.json', 'hash', '1', 'completed', 1)`);
    await source.run(`INSERT INTO location_samples (source, recorded_at_ms, latitude, longitude,
      horizontal_accuracy_m, import_batch_id, fingerprint)
      VALUES ('live-background', ?, 3, 0, 400, 'other-device-batch', 'other-fingerprint-format')`, [Date.UTC(2026, 2, 1)]);

    expect(await importBackupSamples(source, target)).toMatchObject({ addedTileCount: 1, addedPointCount: 1 });
    const restored = await target.first<{ source: string; fingerprint: string; import_batch_id: string | null }>(
      "SELECT source, fingerprint, import_batch_id FROM location_samples");
    expect(restored?.source).toBe("live-background");
    expect(restored?.fingerprint).toMatch(/^location-sample-v1:/);
    expect(restored?.import_batch_id).toBeNull();
  });

  it("skips unreadable points and imports the rest", async () => {
    const source = await database();
    const target = await database();
    for (let i = 0; i < 1_500; i += 1) {
      await addSample(source, new Date(Date.UTC(2026, 1, 1, 0, i)).toISOString(), 1 + i * 0.001);
    }
    await source.run(`INSERT INTO location_samples (source, recorded_at_ms, latitude, longitude, fingerprint)
      VALUES ('external-import', ?, 4, 0, 'bad-time')`, [9e15]);

    expect(await importBackupSamples(source, target)).toMatchObject({
      addedPointCount: 1_500, totalPointCount: 1_501, skippedPointCount: 1,
    });
  });

  it("rejects backups without GPS points, wrong versions and damaged files without changes", async () => {
    const tileOnly = await database();
    await tileOnly.execute("DROP TABLE location_samples");
    const target = await database();
    await expect(importBackupSamples(tileOnly, target)).rejects.toThrow("no GPS points");

    const future = await database();
    await future.execute("PRAGMA user_version = 4");
    await expect(importBackupSamples(future, target)).rejects.toThrow("Unsupported backup version");
    expect(await target.all("SELECT * FROM location_samples")).toEqual([]);
  });

  it("rolls back every point and tile when writing fails", async () => {
    const source = await database();
    const target = await database();
    for (let i = 0; i < 300; i += 1) await addSample(source, new Date(Date.UTC(2026, 1, 1, 0, i)).toISOString(), 1);
    await target.execute(`CREATE TRIGGER fail_import BEFORE INSERT ON unlocked_cells
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);

    await expect(importBackupSamples(source, target)).rejects.toThrow("synthetic failure");
    expect(await target.all("SELECT * FROM location_samples")).toEqual([]);
  });
});
