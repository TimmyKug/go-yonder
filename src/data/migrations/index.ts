import type { SqlDatabase } from "../sql-database";

import { createImportBatchesMigration } from "./001-create-import-batches";
import { createLocationSamplesMigration } from "./002-create-location-samples";
import { createUnlockedCellsMigration } from "./003-create-unlocked-cells";
import type { DatabaseMigration } from "./migration";

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = Object.freeze([
  createImportBatchesMigration,
  createLocationSamplesMigration,
  createUnlockedCellsMigration,
]);

type UserVersionRow = { user_version: number };

function validateMigrationSequence(
  migrations: readonly DatabaseMigration[],
): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `database migration sequence is invalid at version ${expectedVersion}`,
      );
    }
  });
}

export async function runMigrations(
  database: SqlDatabase,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
): Promise<void> {
  validateMigrationSequence(migrations);

  const versionRow = await database.first<UserVersionRow>("PRAGMA user_version");
  const currentVersion = versionRow?.user_version;
  if (!Number.isInteger(currentVersion) || currentVersion === undefined) {
    throw new Error("database did not return a valid user_version");
  }

  const latestVersion = migrations.at(-1)?.version ?? 0;
  if (currentVersion > latestVersion) {
    throw new Error(
      `database version ${currentVersion} is newer than supported version ${latestVersion}`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    await database.withExclusiveTransaction(async (transaction) => {
      await transaction.execute(migration.sql);
      await transaction.execute(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

export type { DatabaseMigration } from "./migration";
