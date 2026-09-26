export type BackupStage =
  | "choose folder"
  | "open folder"
  | "read database"
  | "create file"
  | "write file"
  | "read file"
  | "check file type"
  | "open backup"
  | "open Yonder database"
  | "check and add tiles"
  | "read GPS points"
  | "add GPS points";

const MAX_REASON_LENGTH = 200;

/** A backup failure tagged with the step that failed and a location-free reason. */
export class BackupStageError extends Error {
  readonly stage: BackupStage;
  readonly reason: string;

  constructor(stage: BackupStage, cause: unknown) {
    const reason = describeBackupCause(cause);
    super(`${stage}: ${reason}`, { cause });
    this.name = "BackupStageError";
    this.stage = stage;
    this.reason = reason;
  }
}

export async function atBackupStage<T>(
  stage: BackupStage,
  task: () => T | Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error: unknown) {
    throw error instanceof BackupStageError ? error : new BackupStageError(stage, error);
  }
}

/**
 * Native file and SQLite errors can quote a content URI, a path, or a value, so
 * only the error code and a scrubbed message are kept.
 */
export function describeBackupCause(cause: unknown): string {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : undefined;
  const message = cause instanceof Error ? cause.message : String(cause);
  const scrubbed = message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"()]*/gi, "<uri>")
    .replace(/(^|[\s'"(=:])\/[^\s'"()]*/g, "$1<path>")
    .replace(/-?\d+\.\d+/g, "<number>")
    .replace(/\s+/g, " ")
    .trim();
  const reason = code && !scrubbed.includes(code) ? `${code}: ${scrubbed}` : scrubbed;
  return (reason || "unknown error").slice(0, MAX_REASON_LENGTH);
}

export function isBackupCancellation(error: unknown): boolean {
  return (
    error instanceof BackupStageError &&
    error.stage === "choose folder" &&
    /cancel/i.test(error.reason)
  );
}
