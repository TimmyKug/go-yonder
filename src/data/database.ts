import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { TESSERA_DATABASE_NAME } from "../config/tessera-config";

import { ExpoSqliteDatabase } from "./expo-sqlite-database";
import { runMigrations } from "./migrations";
import type { SqlDatabase } from "./sql-database";

type ConfiguredDatabase = {
  database: SqlDatabase;
  nativeDatabase: SQLiteDatabase;
};

let databasePromise: Promise<ConfiguredDatabase> | undefined;

async function openConfiguredDatabase(): Promise<ConfiguredDatabase> {
  const nativeDatabase = await openDatabaseAsync(TESSERA_DATABASE_NAME);
  const database = new ExpoSqliteDatabase(nativeDatabase);

  await database.execute("PRAGMA journal_mode = WAL");
  await database.execute("PRAGMA foreign_keys = ON");
  await database.execute("PRAGMA busy_timeout = 5000");
  await runMigrations(database);

  return { database, nativeDatabase };
}

function getConfiguredDatabase(): Promise<ConfiguredDatabase> {
  databasePromise ??= openConfiguredDatabase().catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

export async function getDatabase(): Promise<SqlDatabase> {
  return (await getConfiguredDatabase()).database;
}

export async function getNativeDatabase(): Promise<SQLiteDatabase> {
  return (await getConfiguredDatabase()).nativeDatabase;
}
