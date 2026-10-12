import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { SQLiteDatabase } from "expo-sqlite";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  type DatabaseConnection,
  getDatabase,
  isBrokenConnectionError,
  ReconnectingDatabase,
} from "../src/data/database";
import type { SqlDatabase } from "../src/data/sql-database";

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

  close(): void {
    this.connection.close();
  }
}

describe("getDatabase", () => {
  const nativeDatabase = new FakeExpoSqliteDatabase();

  afterAll(() => {
    nativeDatabase.close();
  });

  it("opens once, configures SQLite, and migrates on the same connection", async () => {
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

// Expo's message for a rejected native call, as seen on a device.
const NOT_A_DATABASE = new Error(
  "Call to function 'NativeStatement.finalizeAsync' has been rejected. → Caused by: Error code : file is not a database",
);

function fakeConnection(name: string, failures: Error[] = []) {
  const queries: string[] = [];
  const close = vi.fn(async () => undefined);
  async function query(sql: string) {
    queries.push(sql);
    const failure = failures.shift();
    if (failure) throw failure;
    return name;
  }
  const database = {
    execute: async (sql: string) => { await query(sql); },
    run: async (sql: string) => { await query(sql); return { changes: 1, lastInsertRowId: 1 }; },
    first: query,
    all: async (sql: string) => [await query(sql)],
    withExclusiveTransaction: async (task: (txn: SqlDatabase) => Promise<unknown>) => {
      await query("BEGIN IMMEDIATE");
      return task(database as unknown as SqlDatabase);
    },
  } as unknown as SqlDatabase;
  const connection: DatabaseConnection = {
    database,
    serialize: async () => new Uint8Array(),
    close,
  };
  return { connection, queries, close };
}

describe("isBrokenConnectionError", () => {
  it("recognizes a database that reads as not a database, also as a cause", () => {
    expect(isBrokenConnectionError(NOT_A_DATABASE)).toBe(true);
    expect(isBrokenConnectionError(new Error("rejected", { cause: new Error("disk I/O error") }))).toBe(true);
    expect(isBrokenConnectionError(new Error("UNIQUE constraint failed"))).toBe(false);
    expect(isBrokenConnectionError(undefined)).toBe(false);
  });
});

describe("ReconnectingDatabase", () => {
  it("replaces a connection that stops reading the file and retries the read once", async () => {
    const broken = fakeConnection("broken", [NOT_A_DATABASE]);
    const fresh = fakeConnection("fresh");
    const connect = vi.fn()
      .mockResolvedValueOnce(broken.connection)
      .mockResolvedValueOnce(fresh.connection);
    const onReconnect = vi.fn();
    const database = new ReconnectingDatabase(connect, onReconnect);

    await expect(database.first("SELECT 1")).resolves.toBe("fresh");
    await expect(database.first("SELECT 2")).resolves.toBe("fresh");

    expect(connect).toHaveBeenCalledTimes(2);
    expect(broken.close).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledWith(NOT_A_DATABASE);
    expect(fresh.queries).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("closes the broken connection before opening the fresh one", async () => {
    const order: string[] = [];
    const broken = fakeConnection("broken", [NOT_A_DATABASE]);
    broken.close.mockImplementation(async () => { order.push("close"); });
    const fresh = fakeConnection("fresh");
    const connect = vi.fn()
      .mockResolvedValueOnce(broken.connection)
      .mockImplementationOnce(async () => { order.push("open"); return fresh.connection; });

    await new ReconnectingDatabase(connect).all("SELECT 1");

    expect(order).toEqual(["close", "open"]);
  });

  it("reopens once when concurrent reads fail together", async () => {
    const broken = fakeConnection("broken", [NOT_A_DATABASE, NOT_A_DATABASE]);
    const fresh = fakeConnection("fresh");
    const connect = vi.fn()
      .mockResolvedValueOnce(broken.connection)
      .mockResolvedValueOnce(fresh.connection);
    const database = new ReconnectingDatabase(connect);

    await expect(Promise.all([database.first("A"), database.first("B")]))
      .resolves.toEqual(["fresh", "fresh"]);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("retries a transaction but not a plain write, and leaves other errors alone", async () => {
    const broken = fakeConnection("broken", [NOT_A_DATABASE, NOT_A_DATABASE]);
    const fresh = fakeConnection("fresh", [new Error("UNIQUE constraint failed")]);
    const connect = vi.fn()
      .mockResolvedValueOnce(broken.connection)
      .mockResolvedValueOnce(fresh.connection)
      .mockResolvedValueOnce(fakeConnection("third").connection);
    const database = new ReconnectingDatabase(connect);

    await expect(database.run("INSERT 1")).rejects.toBe(NOT_A_DATABASE);
    await expect(database.run("INSERT 2")).rejects.toThrow("UNIQUE constraint failed");
    await expect(database.withExclusiveTransaction(async (txn) => txn.first("SELECT 3")))
      .resolves.toBe("fresh");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("opens again on the next call when reopening fails", async () => {
    const broken = fakeConnection("broken", [NOT_A_DATABASE]);
    const connect = vi.fn()
      .mockResolvedValueOnce(broken.connection)
      .mockRejectedValueOnce(new Error("cannot open"))
      .mockResolvedValueOnce(fakeConnection("fresh").connection);
    const database = new ReconnectingDatabase(connect);

    await expect(database.first("SELECT 1")).rejects.toThrow("cannot open");
    await expect(database.first("SELECT 2")).resolves.toBe("fresh");
  });
});
