import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { SQLiteDatabase } from "expo-sqlite";
import { afterAll, describe, expect, it, vi } from "vitest";

import { getDatabase } from "../src/data/database";

const sqliteMocks = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: sqliteMocks.openDatabaseAsync,
}));

class FakeExpoSqliteDatabase {
  readonly connection = new DatabaseSync(":memory:");
  readonly executedSql: string[] = [];

  async execAsync(sql: string): Promise<void> {
    this.executedSql.push(sql.trim());
    this.connection.exec(sql);
  }

  async runAsync(sql: string, parameters: readonly SQLInputValue[] = []) {
    const result = this.connection.prepare(sql).run(...parameters);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirstAsync<T>(
    sql: string,
    parameters: readonly SQLInputValue[] = [],
  ): Promise<T | null> {
    const row = this.connection.prepare(sql).get(...parameters);
    return row === undefined ? null : (row as T);
  }

  async getAllAsync<T>(
    sql: string,
    parameters: readonly SQLInputValue[] = [],
  ): Promise<T[]> {
    return this.connection.prepare(sql).all(...parameters) as T[];
  }

  async withExclusiveTransactionAsync(
    task: (transaction: SQLiteDatabase) => Promise<void>,
  ): Promise<void> {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      await task(this as unknown as SQLiteDatabase);
      this.connection.exec("COMMIT");
    } catch (error: unknown) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}

describe("getDatabase", () => {
  const nativeDatabase = new FakeExpoSqliteDatabase();

  afterAll(() => {
    nativeDatabase.close();
  });

  it("opens once, configures SQLite, and migrates through exclusive transactions", async () => {
    sqliteMocks.openDatabaseAsync.mockResolvedValue(
      nativeDatabase as unknown as SQLiteDatabase,
    );

    const [first, second] = await Promise.all([getDatabase(), getDatabase()]);
    const foreignKeys = await first.first<{ foreign_keys: number }>(
      "PRAGMA foreign_keys",
    );
    const busyTimeout = await first.first<{ timeout: number }>(
      "PRAGMA busy_timeout",
    );
    const tables = await second.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );

    expect(first).toBe(second);
    expect(sqliteMocks.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(foreignKeys?.foreign_keys).toBe(1);
    expect(busyTimeout?.timeout).toBe(5_000);
    expect(nativeDatabase.executedSql.slice(0, 3)).toEqual([
      "PRAGMA journal_mode = WAL",
      "PRAGMA foreign_keys = ON",
      "PRAGMA busy_timeout = 5000",
    ]);
    expect(tables.map(({ name }) => name)).toEqual([
      "import_batches",
      "location_samples",
      "unlocked_cells",
    ]);
  });
});
