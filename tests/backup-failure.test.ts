import { describe, expect, it } from "vitest";

import {
  atBackupStage,
  BackupStageError,
  describeBackupCause,
  isBackupCancellation,
} from "@/src/data/backup-failure";

class CodedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

describe("backup failure reasons", () => {
  it("keeps the error code and removes URIs, paths, and coordinate-like numbers", () => {
    const reason = describeBackupCause(new CodedError(
      "ERR_FILE_NOT_WRITABLE",
      "Unable to open 'content://com.example.documents/tree/primary%3AHome%20Town' at 12.345,-67.891 via /data/user/0/app/files/yonder.db",
    ));
    expect(reason).toBe("ERR_FILE_NOT_WRITABLE: Unable to open '<uri>' at <number>,<number> via <path>");
    expect(reason).not.toMatch(/Home|primary|12\.345|yonder\.db/);
  });

  it("describes non-Error values and caps the length", () => {
    expect(describeBackupCause("x".repeat(500))).toHaveLength(200);
    expect(describeBackupCause("")).toBe("unknown error");
  });

  it("tags sync and async failures with the first failing stage only", async () => {
    await expect(atBackupStage("write file", () => { throw new Error("disk full"); }))
      .rejects.toMatchObject({ stage: "write file", reason: "disk full" });
    const inner = atBackupStage("open backup", async () => { throw new Error("no memory"); });
    await expect(atBackupStage("add GPS points", () => inner))
      .rejects.toMatchObject({ stage: "open backup" });
    await expect(atBackupStage("read file", async () => 7)).resolves.toBe(7);
  });

  it("treats only a cancelled folder choice as a cancellation", () => {
    expect(isBackupCancellation(new BackupStageError("choose folder", new Error("The file picker was cancelled by the user")))).toBe(true);
    expect(isBackupCancellation(new BackupStageError("write file", new Error("cancelled")))).toBe(false);
    expect(isBackupCancellation(new Error("canceled"))).toBe(false);
  });
});
