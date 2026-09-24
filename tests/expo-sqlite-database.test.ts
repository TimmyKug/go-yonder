import type { SQLiteDatabase } from "expo-sqlite";
import { expect, it, vi } from "vitest";

import { ExpoSqliteDatabase } from "@/src/data/expo-sqlite-database";

it("gives the separate exclusive-transaction connection a busy timeout before any work", async () => {
  const executed: string[] = [];
  const transaction = {
    execAsync: vi.fn(async (sql: string) => { executed.push(sql); }),
    runAsync: vi.fn(async (sql: string) => { executed.push(sql); return { changes: 1, lastInsertRowId: 1 }; }),
  };
  const native = {
    withExclusiveTransactionAsync: async (task: (txn: typeof transaction) => Promise<void>) => task(transaction),
  } as unknown as SQLiteDatabase;

  const result = await new ExpoSqliteDatabase(native).withExclusiveTransaction(async (txn) => {
    await txn.run("INSERT INTO synthetic VALUES (1)");
    return "done";
  });

  expect(result).toBe("done");
  expect(executed).toEqual(["PRAGMA busy_timeout = 5000", "INSERT INTO synthetic VALUES (1)"]);
});
