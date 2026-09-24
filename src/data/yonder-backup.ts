import { Directory, File, Paths } from "expo-file-system";

import { atBackupStage } from "./backup-failure";
import { getNativeDatabase } from "./database";

export const YONDER_BACKUP_FILE_NAME = "yonder-backup.db";
const AUTOMATIC_BACKUP_INTERVAL_MS = 15 * 60 * 1000;

export type YonderBackupResult = {
  fileName: string;
  sizeBytes: number;
};

type BackupFile = {
  readonly name: string;
  write: (data: Uint8Array) => void;
};

type BackupDirectory = Directory;

type YonderBackupDependencies = {
  createFile: (directory: BackupDirectory) => BackupFile;
  pickDirectory: () => Promise<BackupDirectory>;
  serializeDatabase: () => Promise<Uint8Array>;
};

export const defaultYonderBackupDependencies: YonderBackupDependencies = {
  createFile: (directory) => {
    // Android folders are Storage Access Framework content:// URIs; a child
    // document can only be created through the provider, which picks a unique
    // name when one already exists instead of overwriting it.
    if (directory.uri.startsWith("content://")) {
      const file = directory.createFile(YONDER_BACKUP_FILE_NAME, "application/octet-stream");
      return {
        name: documentDisplayName(file.uri),
        write: (data) => {
          try {
            file.write(data);
          } catch (error: unknown) {
            // Never leave an empty document that looks like a backup.
            try {
              file.delete();
            } catch {
              // The write error is the one worth reporting.
            }
            throw error;
          }
        },
      };
    }
    const file = new File(directory, YONDER_BACKUP_FILE_NAME);
    file.create({ overwrite: true });
    return file;
  },
  pickDirectory: () => Directory.pickDirectoryAsync(),
  serializeDatabase: async () => (await getNativeDatabase()).serializeAsync(),
};

/** The file name inside an Android document URI such as `.../document/primary%3ADocs%2Fyonder-backup%20(1).db`. */
export function documentDisplayName(uri: string): string {
  const lastSegment = uri.split("/").pop() ?? "";
  let decoded = lastSegment;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    // Keep the encoded segment; it still names the file.
  }
  // Some providers use opaque IDs such as `msf:1234` instead of a path.
  const name = decoded.split(/[/:]/).pop() ?? "";
  return name.toLowerCase().endsWith(".db") ? name : YONDER_BACKUP_FILE_NAME;
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
