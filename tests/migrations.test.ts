import { afterEach, describe, expect, it } from "vitest";

import {
  DATABASE_MIGRATIONS,
  runMigrations,
  type DatabaseMigration,
} from "../src/data/migrations";

import { NodeSqliteDatabase } from "./support/node-sqlite-database";

type NameRow = { name: string };
type UserVersionRow = { user_version: number };

describe("database migrations", () => {
  const openDatabases: NodeSqliteDatabase[] = [];

  function createDatabase(): NodeSqliteDatabase {
    const database = new NodeSqliteDatabase();
    openDatabases.push(database);
    return database;
  }

  afterEach(() => {
    openDatabases.splice(0).forEach((database) => database.close());
  });

  it("applies every ordered migration and is repeatable", async () => {
    const database = createDatabase();
    await database.execute("PRAGMA foreign_keys = ON");

    await runMigrations(database);
    await runMigrations(database);

    const version = await database.first<UserVersionRow>("PRAGMA user_version");
    const tables = await database.all<NameRow>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const indexes = await database.all<NameRow>(
      `SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`,
    );

    expect(version?.user_version).toBe(DATABASE_MIGRATIONS.length);
    expect(tables.map(({ name }) => name)).toEqual([
      "import_batches",
      "location_samples",
      "unlocked_cells",
    ]);
    expect(indexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "import_batches_status_created_at_idx",
        "location_samples_recorded_at_idx",
        "unlocked_cells_viewport_idx",
      ]),
    );
  });

  it("enforces source, coordinate, resolution, time-range, and foreign-key checks", async () => {
    const database = createDatabase();
    await database.execute("PRAGMA foreign_keys = ON");
    await runMigrations(database);

    await expect(
      database.run(
        `INSERT INTO location_samples
          (source, recorded_at_ms, latitude, longitude, fingerprint)
         VALUES (?, ?, ?, ?, ?)`,
        ["unsupported", 1, 0, 0, "bad-source"],
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `INSERT INTO location_samples
          (source, recorded_at_ms, latitude, longitude, import_batch_id, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["external-import", 1, 0, 0, "missing-batch", "missing-batch-fingerprint"],
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `INSERT INTO unlocked_cells
          (cell_id, resolution, center_latitude, center_longitude, first_seen_at_ms, last_seen_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["invalid", 16, 0, 0, 20, 10],
      ),
    ).rejects.toThrow();
  });

  it("rolls back a failed migration without advancing user_version", async () => {
    const database = createDatabase();
    const migrations: DatabaseMigration[] = [
      { version: 1, name: "good", sql: "CREATE TABLE good (id INTEGER);" },
      {
        version: 2,
        name: "broken",
        sql: "CREATE TABLE should_rollback (id INTEGER); INVALID SQL;",
      },
    ];

    await expect(runMigrations(database, migrations)).rejects.toThrow();

    const version = await database.first<UserVersionRow>("PRAGMA user_version");
    const rolledBackTable = await database.first<NameRow>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      ["should_rollback"],
    );
    expect(version?.user_version).toBe(1);
    expect(rolledBackTable).toBeNull();
  });

  it("refuses gapped migration sequences and newer databases", async () => {
    const database = createDatabase();

    await expect(
      runMigrations(database, [{ version: 2, name: "gap", sql: "SELECT 1" }]),
    ).rejects.toThrow(/sequence/);

    await database.execute("PRAGMA user_version = 99");
    await expect(runMigrations(database)).rejects.toThrow(/newer/);
  });
});
