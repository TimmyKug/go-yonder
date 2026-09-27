import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
const diagnostics = vi.hoisted(() => [] as [string, Record<string, unknown>][]);

vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItemAsync: async (key: string) => {
      store.delete(key);
    },
  },
}));
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {} }));
vi.mock("@/src/diagnostics/diagnostics", () => ({
  recordDiagnostic: (kind: string, detail: Record<string, unknown>) => diagnostics.push([kind, detail]),
}));
vi.mock("@/src/data/gpx-export", () => ({
  readStoredGpxPoints: vi.fn(),
  YONDER_GPX_FILE_NAME: "yonder-points.gpx",
  GPX_MIME_TYPE: "application/gpx+xml",
}));

const HOUR_MS = 60 * 60 * 1000;
const FOLDER = "content://com.example.documents/tree/primary%3ADocuments%2FYonder";

async function load() {
  vi.resetModules();
  return import("@/src/data/folder-backup");
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const folder = { uri: FOLDER };
  return {
    now: () => Date.parse("2026-03-01T12:00:00Z"),
    openFolder: vi.fn(() => folder as never),
    pickFolder: vi.fn(async () => folder as never),
    readPoints: vi.fn(async () => [{ latitude: 1, longitude: 2, recordedAtMs: 0 }]),
    replaceFile: vi.fn(() => "file"),
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  diagnostics.length = 0;
});

describe("folder backup", () => {
  it("is off until a folder is chosen, then saves right away with the default interval", async () => {
    const backup = await load();
    const deps = dependencies();
    expect(backup.readFolderBackupSettings()).toBeNull();

    await backup.chooseBackupFolder(deps);

    const [folder, name, mimeType, gpx] = deps.replaceFile.mock.calls[0] as unknown as [unknown, string, string, string];
    expect([folder, name, mimeType]).toEqual([{ uri: FOLDER }, "yonder-points.gpx", "application/gpx+xml"]);
    expect(gpx).toContain('<trkpt lat="1" lon="2">');
    expect(deps.replaceFile).toHaveBeenCalledOnce();
    expect(backup.readFolderBackupSettings()).toEqual({
      folderUri: FOLDER,
      intervalHours: 24,
      lastAttemptAtMs: deps.now(),
      lastSuccessAtMs: deps.now(),
    });
    expect(diagnostics).toEqual([["folder-backup", { result: "saved", sizeBytes: gpx.length, pointCount: 1 }]]);
  });

  it("runs again only after the chosen interval", async () => {
    const backup = await load();
    const deps = dependencies();
    await backup.chooseBackupFolder(deps);
    const settings = backup.readFolderBackupSettings();
    const saved = deps.now();

    expect(backup.isFolderBackupDue(settings, saved + 23 * HOUR_MS)).toBe(false);
    expect(backup.isFolderBackupDue(settings, saved + 24 * HOUR_MS)).toBe(true);

    await backup.setFolderBackupInterval(1);
    expect(backup.isFolderBackupDue(backup.readFolderBackupSettings(), saved + HOUR_MS)).toBe(true);
    await backup.setFolderBackupInterval(168);
    expect(backup.isFolderBackupDue(backup.readFolderBackupSettings(), saved + 6 * 24 * HOUR_MS)).toBe(false);
  });

  it("records a failure with its step, keeps the last success and retries after an hour", async () => {
    const backup = await load();
    const deps = dependencies();
    await backup.chooseBackupFolder(deps);
    const failing = dependencies({
      now: () => deps.now() + 25 * HOUR_MS,
      replaceFile: vi.fn(() => {
        throw new Error("Permission denial writing content://com.example.documents/document/x");
      }),
    });

    await backup.runFolderBackupIfDue(failing);

    const settings = backup.readFolderBackupSettings();
    expect(settings).toMatchObject({
      lastSuccessAtMs: deps.now(),
      lastAttemptAtMs: failing.now(),
      lastFailure: { stage: "write file", reason: "Permission denial writing <uri>" },
    });
    expect(backup.isFolderBackupDue(settings, failing.now() + HOUR_MS - 1)).toBe(false);
    expect(backup.isFolderBackupDue(settings, failing.now() + HOUR_MS)).toBe(true);
  });

  it("does nothing when turned off", async () => {
    const backup = await load();
    const deps = dependencies();
    await backup.chooseBackupFolder(deps);
    await backup.turnOffFolderBackup();
    deps.replaceFile.mockClear();

    await backup.runFolderBackup(deps);

    expect(deps.replaceFile).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("falls back to the default interval for an unknown stored value", async () => {
    store.set("folder-backup", JSON.stringify({ folderUri: FOLDER, includeGpx: true, intervalHours: 5 }));
    const backup = await load();
    expect(backup.readFolderBackupSettings()).toEqual({ folderUri: FOLDER, intervalHours: 24 });
  });

  it("names the folder without its storage volume", async () => {
    const backup = await load();
    expect(backup.folderDisplayName(FOLDER)).toBe("Documents/Yonder");
    expect(backup.folderDisplayName("content://p/tree/msf%3A12")).toBe("12");
  });
});
