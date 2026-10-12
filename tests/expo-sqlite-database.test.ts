import type { SQLiteDatabase } from "expo-sqlite";
import { expect, it, vi } from "vitest";

import { ExpoSqliteDatabase } from "@/src/data/expo-sqlite-database";

function fakeConnection(executed: string[], failOn?: string) {
  return {
    execAsync: vi.fn(async (sql: string) => {
      executed.push(sql);
    }),
    runAsync: vi.fn(async (sql: string) => {
      executed.push(sql);
      if (sql === failOn) throw new Error("synthetic failure");
      // Lets a concurrent transaction start if the queue does not hold it back.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { changes: 1, lastInsertRowId: 1 };
    }),
    withExclusiveTransactionAsync: vi.fn(),
  };
}

it("runs transactions on its own connection, one at a time, without opening another", async () => {
  const executed: string[] = [];
  const connection = fakeConnection(executed);
  const database = new ExpoSqliteDatabase(connection as unknown as SQLiteDatabase);

  const results = await Promise.all([
    database.withExclusiveTransaction(async (txn) => {
      await txn.run("INSERT INTO synthetic VALUES (1)");
      return "first";
    }),
    database.withExclusiveTransaction(async (txn) => {
      await txn.run("INSERT INTO synthetic VALUES (2)");
      return "second";
    }),
  ]);

  expect(results).toEqual(["first", "second"]);
  expect(executed).toEqual([
    "BEGIN IMMEDIATE",
    "INSERT INTO synthetic VALUES (1)",
    "COMMIT",
    "BEGIN IMMEDIATE",
    "INSERT INTO synthetic VALUES (2)",
    "COMMIT",
  ]);
  expect(connection.withExclusiveTransactionAsync).not.toHaveBeenCalled();
});

it("rolls back a failed transaction and keeps serving the next one", async () => {
  const executed: string[] = [];
  const database = new ExpoSqliteDatabase(
    fakeConnection(executed, "INSERT INTO synthetic VALUES (1)") as unknown as SQLiteDatabase,
  );

  await expect(database.withExclusiveTransaction((txn) =>
    txn.run("INSERT INTO synthetic VALUES (1)"))).rejects.toThrow("synthetic failure");
  await database.withExclusiveTransaction((txn) => txn.run("INSERT INTO synthetic VALUES (2)"));

  expect(executed).toEqual([
    "BEGIN IMMEDIATE",
    "INSERT INTO synthetic VALUES (1)",
    "ROLLBACK",
    "BEGIN IMMEDIATE",
    "INSERT INTO synthetic VALUES (2)",
    "COMMIT",
  ]);
});
