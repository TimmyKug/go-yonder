import { beforeEach, expect, it, vi } from "vitest";

import { importLocationFile as importYonderBackup } from "@/src/data/import-location-file";

const mocks = vi.hoisted(() => ({ pick: vi.fn(), deserialize: vi.fn(), merge: vi.fn(), close: vi.fn(), getDatabase: vi.fn(), resetCountries: vi.fn(), importGpx: vi.fn() }));
vi.mock("expo-file-system", () => ({ File: { pickFileAsync: mocks.pick } }));
vi.mock("expo-sqlite", () => ({ deserializeDatabaseAsync: mocks.deserialize }));
vi.mock("@/src/data/database", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/data/backup-import-repository", () => ({ mergeBackupUnlocks: mocks.merge }));
vi.mock("@/src/data/country-cache-database", () => ({ getCountryCache: async () => ({}) }));
vi.mock("@/src/data/country-cache-repository", () => ({ resetCountryCache: mocks.resetCountries }));
vi.mock("@/src/data/app-repository", () => ({ ingestNormalizedSamples: vi.fn() }));
vi.mock("@/src/data/gpx-import", () => ({ importGpxText: mocks.importGpx }));

function sqliteBytes() {
  const bytes = new Uint8Array(100);
  bytes.set(new TextEncoder().encode("SQLite format 3\0"));
  bytes[18] = bytes[19] = 2;
  return bytes;
}
function picked(bytes: () => Promise<Uint8Array>, text = async () => "") {
  mocks.pick.mockResolvedValue({ canceled: false, result: { bytes, text } });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.deserialize.mockResolvedValue({ closeAsync: mocks.close });
  mocks.close.mockResolvedValue(undefined);
  mocks.getDatabase.mockResolvedValue({});
});
it("cancellation never opens or changes a database", async () => {
  mocks.pick.mockResolvedValue({ canceled: true, result: null });
  expect(await importYonderBackup()).toBeNull();
  expect(mocks.deserialize).not.toHaveBeenCalled();
  expect(mocks.merge).not.toHaveBeenCalled();
});
it("rejects files that are neither a backup nor GPX before opening anything", async () => {
  picked(async () => new Uint8Array(100), async () => "name,latitude\n");
  await expect(importYonderBackup()).rejects.toMatchObject({ stage: "check file type", reason: "Choose a Yonder backup (.db) or a GPX file." });
  expect(mocks.deserialize).not.toHaveBeenCalled();
  expect(mocks.importGpx).not.toHaveBeenCalled();
});
it("imports GPX files as GPS points and rebuilds the country cache", async () => {
  const gpx = '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>';
  picked(async () => new TextEncoder().encode(gpx), async () => gpx);
  const summary = { pointCount: 0, addedPointCount: 0, alreadyStoredCount: 0, addedTileCount: 0, skippedCount: 0 };
  mocks.importGpx.mockResolvedValue(summary);
  await expect(importYonderBackup()).resolves.toEqual({ kind: "gpx", ...summary });
  expect(mocks.importGpx.mock.calls[0]?.[0]).toBe(gpx);
  expect(mocks.deserialize).not.toHaveBeenCalled();
  expect(mocks.resetCountries).toHaveBeenCalledOnce();
});
it("reports the step when adding GPX points fails", async () => {
  const gpx = "<gpx></gpx>";
  picked(async () => new TextEncoder().encode(gpx), async () => gpx);
  mocks.importGpx.mockRejectedValue(new Error("database is locked"));
  await expect(importYonderBackup()).rejects.toMatchObject({ stage: "add GPS points", reason: "database is locked" });
  expect(mocks.resetCountries).not.toHaveBeenCalled();
});
it("reports a file that cannot be read without quoting its location", async () => {
  picked(async () => { throw new Error("Unable to open input stream for URI: content://com.example.documents/document/primary%3AHome%2Fyonder-backup.db"); });
  await expect(importYonderBackup()).rejects.toMatchObject({ stage: "read file", reason: "Unable to open input stream for URI: <uri>" });
});
it("reports a snapshot SQLite cannot open", async () => {
  picked(async () => sqliteBytes());
  mocks.deserialize.mockRejectedValue(new Error("out of memory"));
  await expect(importYonderBackup()).rejects.toMatchObject({ stage: "open backup", reason: "out of memory" });
  expect(mocks.merge).not.toHaveBeenCalled();
});
it("reports a live database that cannot be opened and still closes the snapshot", async () => {
  picked(async () => sqliteBytes());
  mocks.getDatabase.mockRejectedValue(new Error("database is locked"));
  await expect(importYonderBackup()).rejects.toMatchObject({ stage: "open Yonder database" });
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("opens serialized WAL snapshots in rollback mode and closes them on merge failure", async () => {
  picked(async () => sqliteBytes());
  mocks.merge.mockRejectedValue(new Error("invalid tiles"));
  await expect(importYonderBackup()).rejects.toMatchObject({ stage: "check and add data", reason: "invalid tiles" });
  expect(mocks.deserialize.mock.calls[0]?.[0][18]).toBe(1);
  expect(mocks.deserialize.mock.calls[0]?.[0][19]).toBe(1);
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("rebuilds the country cache after an import, without failing the import if it cannot", async () => {
  picked(async () => sqliteBytes());
  mocks.merge.mockResolvedValue({ addedCount: 1, totalCount: 1, addedSampleCount: 2, totalSampleCount: 2, skippedSampleCount: 0 });
  mocks.resetCountries.mockRejectedValue(new Error("cache unavailable"));
  await expect(importYonderBackup()).resolves.toEqual({ kind: "backup", addedCount: 1, totalCount: 1,
    addedSampleCount: 2, totalSampleCount: 2, skippedSampleCount: 0 });
  expect(mocks.resetCountries).toHaveBeenCalledOnce();
});
it("leaves the country cache alone when an import fails", async () => {
  picked(async () => sqliteBytes());
  mocks.merge.mockRejectedValue(new Error("invalid tiles"));
  await expect(importYonderBackup()).rejects.toThrow();
  expect(mocks.resetCountries).not.toHaveBeenCalled();
});
it("returns the merge result even if closing the snapshot fails", async () => {
  picked(async () => sqliteBytes());
  mocks.merge.mockResolvedValue({ addedCount: 2, totalCount: 3, addedSampleCount: 0, totalSampleCount: 0, skippedSampleCount: 0 });
  mocks.close.mockRejectedValue(new Error("already closed"));
  await expect(importYonderBackup()).resolves.toEqual({ kind: "backup", addedCount: 2, totalCount: 3,
    addedSampleCount: 0, totalSampleCount: 0, skippedSampleCount: 0 });
});
