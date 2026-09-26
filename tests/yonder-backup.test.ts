import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystem = vi.hoisted(() => ({ created: [] as { uri: string }[] }));

vi.mock("expo-file-system", () => ({
  Directory: class Directory {},
  File: class File {
    readonly name = "yonder-backup.db";
    readonly uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}/${name}`;
      fileSystem.created.push(this);
    }
    create() {
      if (this.uri.startsWith("content://")) {
        throw new Error("File.create function does not work with SAF content:// uris");
      }
    }
    write() {}
  },
}));

vi.mock("@/src/data/database", () => ({
  getNativeDatabase: vi.fn(),
}));

import { documentDisplayName as documentName } from "@/src/data/document-files";
import {
  defaultYonderBackupDependencies,
  exportYonderBackup,
  YONDER_BACKUP_FILE_NAME,
} from "@/src/data/yonder-backup";

const bytes = new Uint8Array([83, 81, 76, 105, 116, 101]);

beforeEach(() => {
  fileSystem.created.length = 0;
});

describe("Yonder backup export", () => {
  it("writes one serialized SQLite snapshot to the selected directory", async () => {
    const write = vi.fn();
    const createFile = vi.fn(() => ({ name: YONDER_BACKUP_FILE_NAME, write }));
    const directory = {} as never;

    const result = await exportYonderBackup({
      createFile,
      pickDirectory: async () => directory,
      serializeDatabase: async () => bytes,
    });

    expect(createFile).toHaveBeenCalledWith(directory);
    expect(write).toHaveBeenCalledWith(bytes);
    expect(result).toEqual({
      fileName: YONDER_BACKUP_FILE_NAME,
      sizeBytes: bytes.byteLength,
    });
  });

  it("does not serialize location data until a folder has been selected", async () => {
    const serializeDatabase = vi.fn<() => Promise<Uint8Array>>();

    await expect(
      exportYonderBackup({
        createFile: vi.fn(),
        pickDirectory: async () => {
          throw new Error("canceled");
        },
        serializeDatabase,
      }),
    ).rejects.toMatchObject({ stage: "choose folder", reason: "canceled" });

    expect(serializeDatabase).not.toHaveBeenCalled();
  });

  it("reports the step that failed", async () => {
    const pickDirectory = async () => ({}) as never;
    const serializeDatabase = async () => bytes;
    await expect(exportYonderBackup({
      createFile: () => { throw new Error("no space"); }, pickDirectory, serializeDatabase,
    })).rejects.toMatchObject({ stage: "create file", reason: "no space" });
    await expect(exportYonderBackup({
      createFile: () => ({ name: "x.db", write: () => { throw new Error("read-only"); } }), pickDirectory, serializeDatabase,
    })).rejects.toMatchObject({ stage: "write file", reason: "read-only" });
  });

  it("creates Android documents through the storage provider and reports the name it chose", async () => {
    const write = vi.fn();
    const createFile = vi.fn(() => ({
      uri: "content://com.example.documents/tree/primary%3ABackups/document/primary%3ABackups%2Fyonder-backup%20(1).db",
      write,
    }));
    const directory = { uri: "content://com.example.documents/tree/primary%3ABackups", createFile };

    const result = await exportYonderBackup({
      ...defaultYonderBackupDependencies,
      pickDirectory: async () => directory as never,
      serializeDatabase: async () => bytes,
    });

    expect(createFile).toHaveBeenCalledWith(YONDER_BACKUP_FILE_NAME, "application/octet-stream");
    expect(fileSystem.created).toHaveLength(0);
    expect(write).toHaveBeenCalledWith(bytes);
    expect(result.fileName).toBe("yonder-backup (1).db");
  });

  it("removes a partly written Android document when the write fails", async () => {
    const remove = vi.fn();
    const file = {
      uri: "content://com.example.documents/tree/t/document/t%2Fyonder-backup.db",
      write: () => { throw new Error("provider closed the stream"); },
      delete: remove,
    };
    const directory = { uri: "content://com.example.documents/tree/t", createFile: () => file };

    await expect(exportYonderBackup({
      ...defaultYonderBackupDependencies,
      pickDirectory: async () => directory as never,
      serializeDatabase: async () => bytes,
    })).rejects.toMatchObject({ stage: "write file", reason: "provider closed the stream" });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("replaces the backup by path in app-accessible folders", async () => {
    const directory = { uri: "file:///synthetic/Documents" };
    const result = await exportYonderBackup({
      ...defaultYonderBackupDependencies,
      pickDirectory: async () => directory as never,
      serializeDatabase: async () => bytes,
    });
    expect(fileSystem.created.map((file) => file.uri)).toEqual(["file:///synthetic/Documents/yonder-backup.db"]);
    expect(result.fileName).toBe(YONDER_BACKUP_FILE_NAME);
  });
});

const documentDisplayName = (uri: string) => documentName(uri, YONDER_BACKUP_FILE_NAME);

describe("documentDisplayName", () => {
  it("decodes the file name from path-like document IDs", () => {
    expect(documentDisplayName("content://p/tree/primary%3AA/document/primary%3AA%2FB%2Fyonder-backup.db")).toBe("yonder-backup.db");
    expect(documentDisplayName("content://p/document/raw%3Ayonder-backup%20(2).db")).toBe("yonder-backup (2).db");
  });

  it("falls back to the requested name for opaque document IDs", () => {
    expect(documentDisplayName("content://p/document/msf%3A1234")).toBe(YONDER_BACKUP_FILE_NAME);
    expect(documentDisplayName("content://p/document/%E0%A4%A")).toBe(YONDER_BACKUP_FILE_NAME);
  });
});
