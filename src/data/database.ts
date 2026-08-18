import { openDatabaseAsync } from "expo-sqlite";

import { SCRATCH_MAP_DATABASE_NAME } from "../config/scratch-map-config";

import { ExpoSqliteDatabase } from "./expo-sqlite-database";
import { runMigrations } from "./migrations";
import type { SqlDatabase } from "./sql-database";

let databasePromise: Promise<SqlDatabase> | undefined;

async function openConfiguredDatabase(): Promise<SqlDatabase> {
  const nativeDatabase = await openDatabaseAsync(SCRATCH_MAP_DATABASE_NAME);
  const database = new ExpoSqliteDatabase(nativeDatabase);

  await database.execute("PRAGMA journal_mode = WAL");
  await database.execute("PRAGMA foreign_keys = ON");
  await database.execute("PRAGMA busy_timeout = 5000");
  await runMigrations(database);

  return database;
}

export function getDatabase(): Promise<SqlDatabase> {
  databasePromise ??= openConfiguredDatabase().catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}
