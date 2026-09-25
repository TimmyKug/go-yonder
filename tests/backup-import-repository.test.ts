import { afterEach, describe, expect, it } from "vitest";
import { gridDisk, latLngToCell } from "h3-js";

import { mergeBackupUnlocks } from "@/src/data/backup-import-repository";
import { runMigrations } from "@/src/data/migrations";
import type { SqlDatabase, SqlExecutor } from "@/src/data/sql-database";
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
  it("merges large backups in batches and writes nothing when reimported", async () => {
    const source = await database();
    const target = await database();
    const many = gridDisk(latLngToCell(10, 20, 11), 15); // 721 synthetic cells
    for (const id of many) await add(source, id);
    await add(target, many[0]!, 50, 150);
    const writes: string[] = [];
    const counting: SqlDatabase = {
      execute: (sql) => target.execute(sql), run: (sql, p) => target.run(sql, p),
      first: (sql, p) => target.first(sql, p), all: (sql, p) => target.all(sql, p),
      withExclusiveTransaction: (task) => target.withExclusiveTransaction((txn) => task({
        ...txn,
        execute: (sql) => txn.execute(sql), first: (sql, p) => txn.first(sql, p), all: (sql, p) => txn.all(sql, p),
        run: (sql, p) => { writes.push(sql); return txn.run(sql, p); },
      } satisfies SqlExecutor)),
    };

    expect(await mergeBackupUnlocks(source, counting)).toEqual({ addedCount: 720, totalCount: 721 });
    expect(writes).toHaveLength(2);
    expect(await target.first("SELECT first_seen_at_ms, last_seen_at_ms FROM unlocked_cells WHERE cell_id = ?", [many[0]!]))
      .toEqual({ first_seen_at_ms: 50, last_seen_at_ms: 200 });
    const cells = await target.all("SELECT * FROM unlocked_cells ORDER BY cell_id");
    expect(cells).toHaveLength(721);

    writes.length = 0;
    expect(await mergeBackupUnlocks(source, counting)).toEqual({ addedCount: 0, totalCount: 721 });
    expect(writes).toHaveLength(0);
    expect(await target.all("SELECT * FROM unlocked_cells ORDER BY cell_id")).toEqual(cells);
  });
  it("counts a cell repeated in a snapshot once and keeps its widest visit window", async () => {
    const source = await database();
    const target = await database();
    await source.execute(`CREATE TABLE repeated AS SELECT * FROM unlocked_cells;
      DROP TABLE unlocked_cells; ALTER TABLE repeated RENAME TO unlocked_cells;`);
    await add(source, a, 100, 200);
    await add(source, a, 50, 150);
    expect(await mergeBackupUnlocks(source, target)).toEqual({ addedCount: 1, totalCount: 2 });
    expect(await target.first("SELECT first_seen_at_ms, last_seen_at_ms FROM unlocked_cells WHERE cell_id = ?", [a]))
      .toEqual({ first_seen_at_ms: 50, last_seen_at_ms: 200 });
  });
});
