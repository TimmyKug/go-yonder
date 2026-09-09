import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pick: vi.fn(), deserialize: vi.fn(), merge: vi.fn(), close: vi.fn() }));
vi.mock("expo-file-system", () => ({ File: { pickFileAsync: mocks.pick } }));
vi.mock("expo-sqlite", () => ({ deserializeDatabaseAsync: mocks.deserialize }));
vi.mock("@/src/data/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/src/data/backup-import-repository", () => ({ mergeBackupUnlocks: mocks.merge }));
import { importYonderBackup } from "@/src/data/import-yonder-backup";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.deserialize.mockResolvedValue({ closeAsync: mocks.close });
});
it("cancellation never opens or changes a database", async () => {
  mocks.pick.mockResolvedValue({ canceled: true, result: null });
  expect(await importYonderBackup()).toBeNull();
  expect(mocks.deserialize).not.toHaveBeenCalled();
  expect(mocks.merge).not.toHaveBeenCalled();
});
it("rejects non-database files before deserialization", async () => {
  mocks.pick.mockResolvedValue({ canceled: false, result: { bytes: async () => new Uint8Array(100) } });
  await expect(importYonderBackup()).rejects.toThrow("not a SQLite backup");
  expect(mocks.deserialize).not.toHaveBeenCalled();
});
it("opens serialized WAL snapshots in rollback mode and closes them on merge failure", async () => {
  const bytes = new Uint8Array(100);
  bytes.set(new TextEncoder().encode("SQLite format 3\0"));
  bytes[18] = bytes[19] = 2;
  mocks.pick.mockResolvedValue({ canceled: false, result: { bytes: async () => bytes } });
  mocks.merge.mockRejectedValue(new Error("invalid tiles"));
  await expect(importYonderBackup()).rejects.toThrow("invalid tiles");
  expect(mocks.deserialize.mock.calls[0]?.[0][18]).toBe(1);
  expect(mocks.deserialize.mock.calls[0]?.[0][19]).toBe(1);
  expect(mocks.close).toHaveBeenCalledOnce();
});
