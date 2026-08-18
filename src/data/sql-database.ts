export type SqlValue = string | number | null | Uint8Array;

export type SqlRunResult = {
  changes: number;
  lastInsertRowId: number;
};

export interface SqlExecutor {
  execute(sql: string): Promise<void>;
  run(sql: string, parameters?: readonly SqlValue[]): Promise<SqlRunResult>;
  first<T>(sql: string, parameters?: readonly SqlValue[]): Promise<T | null>;
  all<T>(sql: string, parameters?: readonly SqlValue[]): Promise<T[]>;
}

/** Framework-neutral semantics used by migrations and repositories. */
export interface SqlDatabase extends SqlExecutor {
  withExclusiveTransaction<T>(
    task: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T>;
}
