import { openDatabaseAsync } from "expo-sqlite";

import { YONDER_DATABASE_NAME } from "../config/yonder-config";

import { ExpoSqliteDatabase } from "./expo-sqlite-database";
import { runMigrations } from "./migrations";
import type { SqlDatabase, SqlExecutor, SqlRunResult, SqlValue } from "./sql-database";

export type DatabaseConnection = {
  database: SqlDatabase;
  serialize(): Promise<Uint8Array>;
  close(): Promise<void>;
};

// Errors after which this connection, not the file, may be what is broken.
const BROKEN_CONNECTION_PATTERN = /file is not a database|disk I\/O error/i;

export function isBrokenConnectionError(error: unknown): boolean {
  let cause: unknown = error;
  // Expo wraps the SQLite error as the cause of a rejected native call.
  for (let depth = 0; depth < 4 && cause instanceof Error; depth += 1) {
    if (BROKEN_CONNECTION_PATTERN.test(cause.message)) return true;
    cause = cause.cause;
  }
  return typeof cause === "string" && BROKEN_CONNECTION_PATTERN.test(cause);
}

/**
 * Delegates to one long-lived connection. When it fails as if the file were
 * not a database, it is closed and a fresh one opened; reads and transactions
 * are retried once on it. Writes outside transactions are not retried.
 */
export class ReconnectingDatabase implements SqlDatabase {
  private connection: Promise<DatabaseConnection> | undefined;

  constructor(
    private readonly connect: () => Promise<DatabaseConnection>,
    private readonly onReconnect: (error: unknown) => void = () => undefined,
  ) {}

  current(): Promise<DatabaseConnection> {
    this.connection ??= this.connect().catch((error: unknown) => {
      this.connection = undefined;
      throw error;
    });
    return this.connection;
  }

  execute(sql: string): Promise<void> {
    return this.use((database) => database.execute(sql), false);
  }

  run(sql: string, parameters?: readonly SqlValue[]): Promise<SqlRunResult> {
    return this.use((database) => database.run(sql, parameters), false);
  }

  first<T>(sql: string, parameters?: readonly SqlValue[]): Promise<T | null> {
    return this.use((database) => database.first<T>(sql, parameters), true);
  }

  all<T>(sql: string, parameters?: readonly SqlValue[]): Promise<T[]> {
    return this.use((database) => database.all<T>(sql, parameters), true);
  }

  // A failed transaction was rolled back, so running it again is safe.
  withExclusiveTransaction<T>(task: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    return this.use((database) => database.withExclusiveTransaction(task), true);
  }

  private async use<T>(
    operation: (database: SqlDatabase) => Promise<T>,
    retry: boolean,
  ): Promise<T> {
    const connection = this.current();
    try {
      return await operation((await connection).database);
    } catch (error: unknown) {
      if (!isBrokenConnectionError(error)) throw error;
      if (this.connection === connection) {
        this.onReconnect(error);
        // Close first, so the reopen cannot be handed Expo's cached connection.
        this.connection = connection
          .then((broken) => broken.close())
          .catch(() => undefined)
          .then(() => this.connect())
          .catch((reopenError: unknown) => {
            this.connection = undefined;
            throw reopenError;
          });
      }
      if (!retry) throw error;
      return operation((await this.current()).database);
    }
  }
}

async function openConfiguredDatabase(): Promise<DatabaseConnection> {
  const nativeDatabase = await openDatabaseAsync(YONDER_DATABASE_NAME);
  const database = new ExpoSqliteDatabase(nativeDatabase);

  try {
    await database.execute("PRAGMA journal_mode = WAL");
    await database.execute("PRAGMA foreign_keys = ON");
    await database.execute("PRAGMA busy_timeout = 5000");
    await runMigrations(database);
  } catch (error: unknown) {
    await database.close().catch(() => undefined);
    throw error;
  }

  return {
    database,
    serialize: () => database.serialize(),
    close: () => database.close(),
  };
}

let reconnectListener: (error: unknown) => void = () => undefined;

/** Called whenever the main connection is replaced after failing. */
export function setDatabaseReconnectListener(listener: (error: unknown) => void): void {
  reconnectListener = listener;
}

const mainDatabase = new ReconnectingDatabase(openConfiguredDatabase, (error) =>
  reconnectListener(error));

export async function getDatabase(): Promise<SqlDatabase> {
  await mainDatabase.current();
  return mainDatabase;
}

/** A copy of the whole database file, taken between transactions. */
export async function serializeDatabase(): Promise<Uint8Array> {
  return (await mainDatabase.current()).serialize();
}
