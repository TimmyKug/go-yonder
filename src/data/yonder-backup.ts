import { Directory, File, Paths } from "expo-file-system";

import { getNativeDatabase } from "./database";

// A consistent snapshot of the database in app storage, refreshed after
// ingestion. User-facing export is GPX (see gpx-export.ts).
export const YONDER_BACKUP_FILE_NAME = "yonder-backup.db";
const AUTOMATIC_BACKUP_INTERVAL_MS = 15 * 60 * 1000;

let automaticBackupPromise: Promise<void> | undefined;
let lastAutomaticBackupAtMs = 0;

export async function refreshAutomaticYonderBackup(): Promise<void> {
  if (automaticBackupPromise) {
    return automaticBackupPromise;
  }

  automaticBackupPromise = (async () => {
    const database = await getNativeDatabase();
    const bytes = await database.serializeAsync();
    const backupDirectory = new Directory(Paths.document, "Backups");
    backupDirectory.create({ idempotent: true, intermediates: true });

    const file = new File(backupDirectory, YONDER_BACKUP_FILE_NAME);
    file.create({ overwrite: true });
    file.write(bytes);
    lastAutomaticBackupAtMs = Date.now();
  })().finally(() => {
    automaticBackupPromise = undefined;
  });

  return automaticBackupPromise;
}

export async function refreshAutomaticYonderBackupIfDue(
  nowMs: number = Date.now(),
): Promise<void> {
  if (nowMs - lastAutomaticBackupAtMs < AUTOMATIC_BACKUP_INTERVAL_MS) {
    return;
  }

  await refreshAutomaticYonderBackup();
}
