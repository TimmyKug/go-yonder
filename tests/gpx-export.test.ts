import { describe, expect, it, vi } from "vitest";

import { exportGpx, YONDER_GPX_FILE_NAME } from "@/src/data/gpx-export";

vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {} }));
vi.mock("@/src/data/database", () => ({ getDatabase: vi.fn() }));

describe("exportGpx", () => {
  it("writes every stored point as one GPX file in the chosen folder", async () => {
    const write = vi.fn();
    const result = await exportGpx({
      createFile: () => ({ name: YONDER_GPX_FILE_NAME, write }),
      pickDirectory: async () => ({}) as never,
      readPoints: async () => [
        { latitude: 1, longitude: 2, recordedAtMs: Date.parse("2026-03-01T08:00:00Z") },
        { latitude: 1.001, longitude: 2, recordedAtMs: Date.parse("2026-03-01T08:00:30Z") },
      ],
    });

    expect(result).toEqual({ fileName: YONDER_GPX_FILE_NAME, pointCount: 2 });
    expect(write.mock.calls[0]?.[0]).toMatch(/^<\?xml[\s\S]*<trkpt lat="1" lon="2"><time>2026-03-01T08:00:00.000Z<\/time><\/trkpt>/);
  });

  it("reads no points until a folder is chosen, and reports the failing step", async () => {
    const readPoints = vi.fn(async () => []);
    await expect(exportGpx({
      createFile: vi.fn(),
      pickDirectory: async () => { throw new Error("canceled"); },
      readPoints,
    })).rejects.toMatchObject({ stage: "choose folder" });
    expect(readPoints).not.toHaveBeenCalled();

    await expect(exportGpx({
      createFile: () => ({ name: "x.gpx", write: () => { throw new Error("no space"); } }),
      pickDirectory: async () => ({}) as never,
      readPoints,
    })).rejects.toMatchObject({ stage: "write file", reason: "no space" });
  });
});
