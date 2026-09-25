import { openDatabaseAsync } from "expo-sqlite";

import { COUNTRY_CACHE_MIGRATIONS } from "./country-cache-repository";
import { ExpoSqliteDatabase } from "./expo-sqlite-database";
import { runMigrations } from "./migrations";
import type { SqlDatabase } from "./sql-database";

// Kept apart from the main database so backups, which serialize that whole
// file, never contain it and keep their schema version. It can always be
// rebuilt from the unlocked cells.
const COUNTRY_CACHE_DATABASE_NAME = "yonder-country-cache.db";

let cachePromise: Promise<SqlDatabase> | undefined;

async function openCountryCache(): Promise<SqlDatabase> {
  const database = new ExpoSqliteDatabase(
    await openDatabaseAsync(COUNTRY_CACHE_DATABASE_NAME),
  );
  await database.execute("PRAGMA journal_mode = WAL");
  await database.execute("PRAGMA busy_timeout = 5000");
  await runMigrations(database, COUNTRY_CACHE_MIGRATIONS);
  return database;
}

export function getCountryCache(): Promise<SqlDatabase> {
  cachePromise ??= openCountryCache().catch((error: unknown) => {
    cachePromise = undefined;
    throw error;
  });
  return cachePromise;
}
