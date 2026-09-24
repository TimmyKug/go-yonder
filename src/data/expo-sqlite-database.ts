import type { SQLiteDatabase } from "expo-sqlite";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRunResult,
  SqlValue,
} from "./sql-database";

const TRANSACTION_BUSY_TIMEOUT_MS = 5000;

type ExpoSqliteConnection = Pick<
  SQLiteDatabase,
  "execAsync" | "runAsync" | "getFirstAsync" | "getAllAsync"
>;

class ExpoSqliteExecutor implements SqlExecutor {
  constructor(protected readonly connection: ExpoSqliteConnection) {}

  async execute(sql: string): Promise<void> {
    await this.connection.execAsync(sql);
  }

  async run(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<SqlRunResult> {
    const result = await this.connection.runAsync(sql, [...parameters]);
    return {
      changes: result.changes,
      lastInsertRowId: result.lastInsertRowId,
    };
  }

  first<T>(sql: string, parameters: readonly SqlValue[] = []): Promise<T | null> {
    return this.connection.getFirstAsync<T>(sql, [...parameters]);
  }

  all<T>(sql: string, parameters: readonly SqlValue[] = []): Promise<T[]> {
    return this.connection.getAllAsync<T>(sql, [...parameters]);
  }
}

export class ExpoSqliteDatabase
  extends ExpoSqliteExecutor
  implements SqlDatabase
{
  constructor(private readonly database: SQLiteDatabase) {
    super(database);
  }

  async withExclusiveTransaction<T>(
    task: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    let outcome: { value: T } | undefined;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      // Expo runs exclusive transactions on a new connection, which does not
      // inherit the main connection's busy timeout. Without one, a concurrent
      // background write fails the transaction at once with "database is locked".
      await transaction.execAsync(`PRAGMA busy_timeout = ${TRANSACTION_BUSY_TIMEOUT_MS}`);
      outcome = {
        value: await task(new ExpoSqliteExecutor(transaction)),
      };
    });

    if (outcome === undefined) {
      throw new Error("exclusive transaction completed without a result");
    }
    return outcome.value;
  }
}
