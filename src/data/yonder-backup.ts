import { Directory, File, Paths } from "expo-file-system";

import { getNativeDatabase } from "./database";

export const YONDER_BACKUP_FILE_NAME = "yonder-backup.db";
const AUTOMATIC_BACKUP_INTERVAL_MS = 15 * 60 * 1000;

export type YonderBackupResult = {
  fileName: string;
  sizeBytes: number;
};

type BackupFile = {
  write: (data: Uint8Array) => void;
};

type BackupDirectory = Directory;

type YonderBackupDependencies = {
  createFile: (directory: BackupDirectory) => BackupFile;
  pickDirectory: () => Promise<BackupDirectory>;
  serializeDatabase: () => Promise<Uint8Array>;
};

const defaultDependencies: YonderBackupDependencies = {
  createFile: (directory) => {
    const file = new File(directory, YONDER_BACKUP_FILE_NAME);
    file.create({ overwrite: true });
    return file;
  },
  pickDirectory: () => Directory.pickDirectoryAsync(),
  serializeDatabase: async () => (await getNativeDatabase()).serializeAsync(),
};

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

export async function exportYonderBackup(
  dependencies: YonderBackupDependencies = defaultDependencies,
): Promise<YonderBackupResult> {
  const directory = await dependencies.pickDirectory();
  const bytes = await dependencies.serializeDatabase();
  const file = dependencies.createFile(directory);

  file.write(bytes);

  return {
    fileName: YONDER_BACKUP_FILE_NAME,
    sizeBytes: bytes.byteLength,
  };
}
