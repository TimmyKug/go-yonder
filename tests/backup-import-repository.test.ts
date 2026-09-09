import { afterEach, describe, expect, it } from "vitest";
import { latLngToCell } from "h3-js";

import { mergeBackupUnlocks } from "@/src/data/backup-import-repository";
import { runMigrations } from "@/src/data/migrations";
import { NodeSqliteDatabase } from "./support/node-sqlite-database";

const databases: NodeSqliteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
async function database() {
  const db = new NodeSqliteDatabase();
  databases.push(db);
  await runMigrations(db);
  return db;
}
async function add(db: NodeSqliteDatabase, id: string, first = 100, last = 200) {
  await db.run("INSERT INTO unlocked_cells VALUES (?, 11, 0, 0, ?, ?)", [id, first, last]);
}
const a = latLngToCell(0, 0, 11);
const b = latLngToCell(1, 1, 11);
const c = latLngToCell(2, 2, 11);

describe("additive backup import", () => {
  it("preserves local-only cells and raw history, unions tiles and visit times, and is idempotent", async () => {
    const source = await database();
    const target = await database();
    await add(target, a);
    await add(target, b);
    await add(source, b, 50, 300);
    await add(source, c);
    await target.run(`INSERT INTO location_samples
      (source, recorded_at_ms, latitude, longitude, fingerprint)
      VALUES ('live-foreground', 100, 0, 0, 'synthetic')`);
    const history = await target.all("SELECT * FROM location_samples");
    expect(await mergeBackupUnlocks(source, target)).toEqual({ addedCount: 1, totalCount: 2 });
    expect(await target.all("SELECT * FROM location_samples")).toEqual(history);
    expect(await target.first("SELECT first_seen_at_ms, last_seen_at_ms FROM unlocked_cells WHERE cell_id = ?", [b])).toEqual({ first_seen_at_ms: 50, last_seen_at_ms: 300 });
    const cells = await target.all("SELECT * FROM unlocked_cells ORDER BY cell_id");
    expect(cells).toHaveLength(3);
    expect(await mergeBackupUnlocks(source, target)).toEqual({ addedCount: 0, totalCount: 2 });
    expect(await target.all("SELECT * FROM unlocked_cells ORDER BY cell_id")).toEqual(cells);
  });
  it("rejects invalid cells before adding any valid cells", async () => {
    const source = await database();
    const target = await database();
    await add(target, a);
    await add(source, b);
    await add(source, "invalid");
    const before = await target.all("SELECT * FROM unlocked_cells");
    await expect(mergeBackupUnlocks(source, target)).rejects.toThrow("invalid or unsupported");
    expect(await target.all("SELECT * FROM unlocked_cells")).toEqual(before);
  });
  it("rejects unsupported schema versions", async () => {
    const source = await database();
    await source.execute("PRAGMA user_version = 4");
    await expect(mergeBackupUnlocks(source, await database())).rejects.toThrow("Unsupported backup version");
  });
  it("rolls back all additions when persistence fails", async () => {
    const source = await database();
    const target = await database();
    await add(source, b);
    await add(source, c);
    await target.execute(`CREATE TRIGGER fail_import BEFORE INSERT ON unlocked_cells
      WHEN NEW.cell_id = '${c}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
    await expect(mergeBackupUnlocks(source, target)).rejects.toThrow("synthetic failure");
    expect(await target.all("SELECT * FROM unlocked_cells")).toEqual([]);
  });
});
