import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => ({
  Directory: class Directory {},
  File: class File {},
}));

vi.mock("@/src/data/database", () => ({
  getNativeDatabase: vi.fn(),
}));

import {
  exportScratchMapBackup,
  SCRATCH_MAP_BACKUP_FILE_NAME,
} from "@/src/data/scratch-map-backup";

describe("Scratch Map backup export", () => {
  it("writes one serialized SQLite snapshot to the selected directory", async () => {
    const write = vi.fn();
    const createFile = vi.fn(() => ({ write }));
    const directory = {} as never;
    const bytes = new Uint8Array([83, 81, 76, 105, 116, 101]);

    const result = await exportScratchMapBackup({
      createFile,
      pickDirectory: async () => directory,
      serializeDatabase: async () => bytes,
    });

    expect(createFile).toHaveBeenCalledWith(directory);
    expect(write).toHaveBeenCalledWith(bytes);
    expect(result).toEqual({
      fileName: SCRATCH_MAP_BACKUP_FILE_NAME,
      sizeBytes: bytes.byteLength,
    });
  });

  it("does not serialize location data until a folder has been selected", async () => {
    const serializeDatabase = vi.fn<() => Promise<Uint8Array>>();

    await expect(
      exportScratchMapBackup({
        createFile: vi.fn(),
        pickDirectory: async () => {
          throw new Error("canceled");
        },
        serializeDatabase,
      }),
    ).rejects.toThrow("canceled");

    expect(serializeDatabase).not.toHaveBeenCalled();
  });
});
