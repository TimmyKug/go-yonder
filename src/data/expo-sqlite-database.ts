import type { SQLiteDatabase } from "expo-sqlite";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRunResult,
  SqlValue,
} from "./sql-database";

type ExpoSqliteConnection = Pick<
  SQLiteDatabase,
  "execAsync" | "runAsync" | "getFirstAsync" | "getAllAsync" | "serializeAsync" | "closeAsync"
>;

export class ExpoSqliteDatabase implements SqlDatabase {
  private transactionQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly connection: ExpoSqliteConnection) {}

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

  /**
   * Runs transactions one at a time on this connection. Expo's exclusive
   * transactions open and close a new connection each time; on Android that
   * churn, once per location update, left the long-lived connection failing
   * every read with "file is not a database". Reads issued meanwhile on this
   * connection see the transaction's uncommitted rows.
   */
  withExclusiveTransaction<T>(
    task: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      await this.execute("BEGIN IMMEDIATE");
      try {
        const result = await task(this);
        await this.execute("COMMIT");
        return result;
      } catch (error: unknown) {
        await this.execute("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  }

  /** A copy of the database file between transactions, never mid-way. */
  serialize(): Promise<Uint8Array> {
    return this.enqueue(() => this.connection.serializeAsync());
  }

  close(): Promise<void> {
    return this.enqueue(() => this.connection.closeAsync());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(operation);
    this.transactionQueue = run.catch(() => undefined);
    return run;
  }
}
