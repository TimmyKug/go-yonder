import { Directory, File, Paths } from "expo-file-system";

import { atBackupStage } from "./backup-failure";
import { getNativeDatabase } from "./database";
import { createDocument, type WrittenDocument } from "./document-files";

export const YONDER_BACKUP_FILE_NAME = "yonder-backup.db";
export const YONDER_BACKUP_MIME_TYPE = "application/octet-stream";
const AUTOMATIC_BACKUP_INTERVAL_MS = 15 * 60 * 1000;

export type YonderBackupResult = {
  fileName: string;
  sizeBytes: number;
};

type BackupDirectory = Directory;

type YonderBackupDependencies = {
  createFile: (directory: BackupDirectory) => WrittenDocument;
  pickDirectory: () => Promise<BackupDirectory>;
  serializeDatabase: () => Promise<Uint8Array>;
};

export const defaultYonderBackupDependencies: YonderBackupDependencies = {
  createFile: (directory) =>
    createDocument(directory, YONDER_BACKUP_FILE_NAME, YONDER_BACKUP_MIME_TYPE),
  pickDirectory: () => Directory.pickDirectoryAsync(),
  serializeDatabase: serializeYonderDatabase,
};

export async function serializeYonderDatabase(): Promise<Uint8Array> {
  return (await getNativeDatabase()).serializeAsync();
}

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
  dependencies: YonderBackupDependencies = defaultYonderBackupDependencies,
): Promise<YonderBackupResult> {
  const directory = await atBackupStage("choose folder", dependencies.pickDirectory);
  const bytes = await atBackupStage("read database", dependencies.serializeDatabase);
  const file = await atBackupStage("create file", () => dependencies.createFile(directory));

  await atBackupStage("write file", () => file.write(bytes));

  return {
    fileName: file.name,
    sizeBytes: bytes.byteLength,
  };
}
