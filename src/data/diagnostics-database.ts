import { openDatabaseAsync } from "expo-sqlite";

import {
  createDiagnosticsRepository,
  DIAGNOSTICS_MIGRATIONS,
  type DiagnosticsRepository,
} from "./diagnostics-repository";
import { ExpoSqliteDatabase } from "./expo-sqlite-database";
import { runMigrations } from "./migrations";

// Kept apart from the main database so backups, which serialize that whole
// file, never contain diagnostics and keep their schema version.
const DIAGNOSTICS_DATABASE_NAME = "yonder-diagnostics.db";

let repositoryPromise: Promise<DiagnosticsRepository> | undefined;

async function openDiagnosticsRepository(): Promise<DiagnosticsRepository> {
  const database = new ExpoSqliteDatabase(
    await openDatabaseAsync(DIAGNOSTICS_DATABASE_NAME),
  );

  await database.execute("PRAGMA journal_mode = WAL");
  await database.execute("PRAGMA busy_timeout = 5000");
  await runMigrations(database, DIAGNOSTICS_MIGRATIONS);

  const repository = createDiagnosticsRepository(database);
  await repository.prune(Date.now());
  return repository;
}

export function getDiagnosticsRepository(): Promise<DiagnosticsRepository> {
  repositoryPromise ??= openDiagnosticsRepository().catch((error: unknown) => {
    repositoryPromise = undefined;
    throw error;
  });
  return repositoryPromise;
}
