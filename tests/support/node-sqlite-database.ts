import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRunResult,
  SqlValue,
} from "../../src/data/sql-database";

function nodeParameters(parameters: readonly SqlValue[]): SQLInputValue[] {
  return [...parameters];
}

class NodeSqliteExecutor implements SqlExecutor {
  constructor(protected readonly database: DatabaseSync) {}

  async execute(sql: string): Promise<void> {
    this.database.exec(sql);
  }

  async run(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<SqlRunResult> {
    const result = this.database.prepare(sql).run(...nodeParameters(parameters));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async first<T>(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<T | null> {
    const row = this.database.prepare(sql).get(...nodeParameters(parameters));
    return row === undefined ? null : (row as T);
  }

  async all<T>(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<T[]> {
    return this.database
      .prepare(sql)
      .all(...nodeParameters(parameters)) as T[];
  }
}

export class NodeSqliteDatabase
  extends NodeSqliteExecutor
  implements SqlDatabase
{
  private transactionQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    const database = new DatabaseSync(":memory:");
    super(database);
  }

  // Like the app's connection: transactions wait for each other.
  withExclusiveTransaction<T>(
    task: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    const run = this.transactionQueue.then(async () => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = await task(new NodeSqliteExecutor(this.database));
        this.database.exec("COMMIT");
        return result;
      } catch (error: unknown) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    });
    this.transactionQueue = run.catch(() => undefined);
    return run;
  }

  close(): void {
    this.database.close();
  }
}
