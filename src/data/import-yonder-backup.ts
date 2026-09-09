import { File } from "expo-file-system";
import { deserializeDatabaseAsync } from "expo-sqlite";

import { mergeBackupUnlocks } from "@/src/data/backup-import-repository";
import { getDatabase } from "@/src/data/database";
import { ExpoSqliteDatabase } from "@/src/data/expo-sqlite-database";

export async function importYonderBackup() {
  const selection = await File.pickFileAsync({});
  if (selection.canceled) return null;
  const bytes = await selection.result.bytes();
  if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 16)) !== "SQLite format 3\0") {
    throw new Error("This is not a SQLite backup.");
  }
  // Serialized WAL snapshots must use rollback mode when opened in memory.
  // https://www.sqlite.org/c3ref/deserialize.html
  bytes[18] = 1;
  bytes[19] = 1;
  const snapshot = await deserializeDatabaseAsync(bytes);
  try {
    return await mergeBackupUnlocks(new ExpoSqliteDatabase(snapshot), await getDatabase());
  } finally {
    await snapshot.closeAsync();
  }
}
