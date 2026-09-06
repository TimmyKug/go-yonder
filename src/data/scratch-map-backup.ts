import { Directory, File, Paths } from "expo-file-system";

import { getNativeDatabase } from "./database";

export const SCRATCH_MAP_BACKUP_FILE_NAME = "scratch-map-backup.db";
const AUTOMATIC_BACKUP_INTERVAL_MS = 15 * 60 * 1000;

export type ScratchMapBackupResult = {
  fileName: string;
  sizeBytes: number;
};

type BackupFile = {
  write: (data: Uint8Array) => void;
};

type BackupDirectory = Directory;

type ScratchMapBackupDependencies = {
  createFile: (directory: BackupDirectory) => BackupFile;
  pickDirectory: () => Promise<BackupDirectory>;
  serializeDatabase: () => Promise<Uint8Array>;
};

const defaultDependencies: ScratchMapBackupDependencies = {
  createFile: (directory) => {
    const file = new File(directory, SCRATCH_MAP_BACKUP_FILE_NAME);
    file.create({ overwrite: true });
    return file;
  },
  pickDirectory: () => Directory.pickDirectoryAsync(),
  serializeDatabase: async () => (await getNativeDatabase()).serializeAsync(),
};

let automaticBackupPromise: Promise<void> | undefined;
let lastAutomaticBackupAtMs = 0;

export async function refreshAutomaticScratchMapBackup(): Promise<void> {
  if (automaticBackupPromise) {
    return automaticBackupPromise;
  }

  automaticBackupPromise = (async () => {
    const database = await getNativeDatabase();
    const bytes = await database.serializeAsync();
    const backupDirectory = new Directory(Paths.document, "Backups");
    backupDirectory.create({ idempotent: true, intermediates: true });

    const file = new File(backupDirectory, SCRATCH_MAP_BACKUP_FILE_NAME);
    file.create({ overwrite: true });
    file.write(bytes);
    lastAutomaticBackupAtMs = Date.now();
  })().finally(() => {
    automaticBackupPromise = undefined;
  });

  return automaticBackupPromise;
}

export async function refreshAutomaticScratchMapBackupIfDue(
  nowMs: number = Date.now(),
): Promise<void> {
  if (nowMs - lastAutomaticBackupAtMs < AUTOMATIC_BACKUP_INTERVAL_MS) {
    return;
  }

  await refreshAutomaticScratchMapBackup();
}

export async function exportScratchMapBackup(
  dependencies: ScratchMapBackupDependencies = defaultDependencies,
): Promise<ScratchMapBackupResult> {
  const directory = await dependencies.pickDirectory();
  const bytes = await dependencies.serializeDatabase();
  const file = dependencies.createFile(directory);

  file.write(bytes);

  return {
    fileName: SCRATCH_MAP_BACKUP_FILE_NAME,
    sizeBytes: bytes.byteLength,
  };
}
