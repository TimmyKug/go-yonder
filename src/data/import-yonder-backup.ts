import { File } from "expo-file-system";
import { deserializeDatabaseAsync } from "expo-sqlite";

import { atBackupStage } from "@/src/data/backup-failure";
import { mergeBackupUnlocks } from "@/src/data/backup-import-repository";
import { getDatabase } from "@/src/data/database";
import { ExpoSqliteDatabase } from "@/src/data/expo-sqlite-database";

export async function importYonderBackup() {
  // The picker reports every failure, not only a cancellation, as canceled.
  const selection = await File.pickFileAsync({});
  if (selection.canceled) return null;
  const file = selection.result;
  const bytes = await atBackupStage("read file", () => file.bytes());
  await atBackupStage("check file type", () => {
    if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 16)) !== "SQLite format 3\0") {
      throw new Error("This is not a SQLite backup.");
    }
  });
  // Serialized WAL snapshots must use rollback mode when opened in memory.
  // https://www.sqlite.org/c3ref/deserialize.html
  bytes[18] = 1;
  bytes[19] = 1;
  const snapshot = await atBackupStage("open backup", () => deserializeDatabaseAsync(bytes));
  try {
    const target = await atBackupStage("open Yonder database", getDatabase);
    return await atBackupStage("check and add tiles", () =>
      mergeBackupUnlocks(new ExpoSqliteDatabase(snapshot), target));
  } finally {
    // Closing an in-memory snapshot cannot lose data; never mask the result.
    await snapshot.closeAsync().catch(() => undefined);
  }
}
