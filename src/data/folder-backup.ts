import { Directory } from "expo-file-system";
import Storage from "expo-sqlite/kv-store";

import { formatGpx, type GpxPoint } from "../domain/gpx";

import { atBackupStage, BackupStageError, describeBackupCause } from "./backup-failure";
import { replaceDocument } from "./document-files";
import { GPX_MIME_TYPE, readStoredGpxPoints, YONDER_GPX_FILE_NAME } from "./gpx-export";
import {
  serializeYonderDatabase,
  YONDER_BACKUP_FILE_NAME,
  YONDER_BACKUP_MIME_TYPE,
} from "./yonder-backup";

import { recordDiagnostic } from "@/src/diagnostics/diagnostics";

/** How often the automatic backup may run, in hours. */
export const BACKUP_INTERVAL_OPTIONS_HOURS = [1, 6, 24, 168] as const;
export type BackupIntervalHours = (typeof BACKUP_INTERVAL_OPTIONS_HOURS)[number];
export const DEFAULT_BACKUP_INTERVAL_HOURS: BackupIntervalHours = 24;

export type FolderBackupSettings = {
  /** A folder the user picked; Android keeps the permission to write to it. */
  folderUri: string;
  /** Also replace a GPX file with every stored GPS point. */
  includeGpx: boolean;
  intervalHours: BackupIntervalHours;
  lastSuccessAtMs?: number;
  lastAttemptAtMs?: number;
  lastFailure?: { stage: string; reason: string };
};

const SETTINGS_KEY = "folder-backup";
const HOUR_MS = 60 * 60 * 1000;
// A failed backup is retried at most this often.
const RETRY_INTERVAL_MS = HOUR_MS;

const listeners = new Set<() => void>();
let cached: FolderBackupSettings | null | undefined;

function parseSettings(value: string | null): FolderBackupSettings | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" && parsed !== null &&
      "folderUri" in parsed && typeof parsed.folderUri === "string" && parsed.folderUri
    ) {
      const settings = parsed as FolderBackupSettings;
      const intervalHours =
        BACKUP_INTERVAL_OPTIONS_HOURS.find((option) => option === settings.intervalHours) ??
        DEFAULT_BACKUP_INTERVAL_HOURS;
      return { ...settings, includeGpx: settings.includeGpx === true, intervalHours };
    }
  } catch {
    // Treat unreadable settings as turned off.
  }
  return null;
}

export function readFolderBackupSettings(): FolderBackupSettings | null {
  if (cached !== undefined) return cached;
  try {
    cached = parseSettings(Storage.getItemSync(SETTINGS_KEY));
  } catch {
    return null;
  }
  return cached;
}

async function writeSettings(settings: FolderBackupSettings | null): Promise<void> {
  if (settings) await Storage.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
  else await Storage.removeItemAsync(SETTINGS_KEY);
  cached = settings;
  listeners.forEach((listener) => listener());
}

export function subscribeFolderBackupSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type FolderBackupDependencies = {
  openFolder: (uri: string) => Directory;
  pickFolder: () => Promise<Directory>;
  readPoints: () => Promise<GpxPoint[]>;
  replaceFile: typeof replaceDocument;
  serializeDatabase: () => Promise<Uint8Array>;
  now: () => number;
};

export const defaultFolderBackupDependencies: FolderBackupDependencies = {
  openFolder: (uri) => new Directory(uri),
  pickFolder: () => Directory.pickDirectoryAsync(),
  readPoints: readStoredGpxPoints,
  replaceFile: replaceDocument,
  serializeDatabase: serializeYonderDatabase,
  now: () => Date.now(),
};

/** Asks for a folder, turns automatic backups on and saves the first one. */
export async function chooseBackupFolder(
  dependencies: FolderBackupDependencies = defaultFolderBackupDependencies,
): Promise<void> {
  const folder = await atBackupStage("choose folder", dependencies.pickFolder);
  const previous = readFolderBackupSettings();
  await writeSettings({
    folderUri: folder.uri,
    includeGpx: previous?.includeGpx ?? false,
    intervalHours: previous?.intervalHours ?? DEFAULT_BACKUP_INTERVAL_HOURS,
  });
  await runFolderBackup(dependencies);
}

export async function setFolderBackupIncludesGpx(includeGpx: boolean): Promise<void> {
  const settings = readFolderBackupSettings();
  if (settings) await writeSettings({ ...settings, includeGpx });
}

export async function setFolderBackupInterval(intervalHours: BackupIntervalHours): Promise<void> {
  const settings = readFolderBackupSettings();
  if (settings) await writeSettings({ ...settings, intervalHours });
}

export async function turnOffFolderBackup(): Promise<void> {
  await writeSettings(null);
}

export function isFolderBackupDue(settings: FolderBackupSettings | null, nowMs: number): boolean {
  if (!settings) return false;
  if (settings.lastAttemptAtMs !== undefined && nowMs - settings.lastAttemptAtMs < RETRY_INTERVAL_MS) {
    return false;
  }
  return (
    settings.lastSuccessAtMs === undefined ||
    nowMs - settings.lastSuccessAtMs >= settings.intervalHours * HOUR_MS
  );
}

let runningBackup: Promise<void> | undefined;

/**
 * Replaces the backup (and optionally the GPX file) in the chosen folder.
 * Failures are recorded for Settings rather than thrown.
 */
export function runFolderBackup(
  dependencies: FolderBackupDependencies = defaultFolderBackupDependencies,
): Promise<void> {
  runningBackup ??= (async () => {
    const settings = readFolderBackupSettings();
    if (!settings) return;
    const startedAtMs = dependencies.now();
    try {
      const folder = await atBackupStage("open folder", () => dependencies.openFolder(settings.folderUri));
      const bytes = await atBackupStage("read database", dependencies.serializeDatabase);
      await atBackupStage("write file", () =>
        dependencies.replaceFile(folder, YONDER_BACKUP_FILE_NAME, YONDER_BACKUP_MIME_TYPE, bytes));
      let pointCount: number | null = null;
      if (settings.includeGpx) {
        const points = await atBackupStage("read GPS points", dependencies.readPoints);
        pointCount = points.length;
        await atBackupStage("write file", () =>
          dependencies.replaceFile(folder, YONDER_GPX_FILE_NAME, GPX_MIME_TYPE, formatGpx(points)));
      }
      // Keep changes the user made meanwhile, unless the folder changed.
      const current = readFolderBackupSettings();
      if (current?.folderUri === settings.folderUri) {
        await writeSettings({
          ...current,
          lastAttemptAtMs: startedAtMs,
          lastSuccessAtMs: startedAtMs,
          lastFailure: undefined,
        });
      }
      recordDiagnostic("folder-backup", { result: "saved", sizeBytes: bytes.byteLength, pointCount });
    } catch (error: unknown) {
      const stage = error instanceof BackupStageError ? error.stage : "unknown step";
      const reason = error instanceof BackupStageError ? error.reason : describeBackupCause(error);
      recordDiagnostic("folder-backup", { result: "failed", stage, reason });
      const current = readFolderBackupSettings();
      if (current?.folderUri === settings.folderUri) {
        await writeSettings({ ...current, lastAttemptAtMs: startedAtMs, lastFailure: { stage, reason } })
          .catch(() => undefined);
      }
    }
  })().finally(() => {
    runningBackup = undefined;
  });
  return runningBackup;
}

export async function runFolderBackupIfDue(
  dependencies: FolderBackupDependencies = defaultFolderBackupDependencies,
): Promise<void> {
  if (isFolderBackupDue(readFolderBackupSettings(), dependencies.now())) {
    await runFolderBackup(dependencies);
  }
}

/** A readable folder name from a document tree URI, e.g. `Documents/Yonder`. */
export function folderDisplayName(uri: string): string {
  const lastSegment = uri.replace(/\/+$/, "").split("/").pop() ?? "";
  let decoded = lastSegment;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    // Keep the encoded segment.
  }
  // Tree IDs look like `primary:Documents/Yonder`; drop the storage volume.
  const path = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : decoded;
  return path || "the chosen folder";
}
