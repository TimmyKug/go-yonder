import type * as Location from "expo-location";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: vi.fn() },
  Platform: { OS: "android", Version: 35 },
}));
vi.mock("@/src/data/diagnostics-database", () => ({
  getDiagnosticsRepository: vi.fn(),
}));
vi.mock("expo-task-manager", () => ({
  defineTask: vi.fn(),
  isTaskDefined: vi.fn(() => true),
}));
vi.mock("@/src/location/location-ingestion", () => ({
  ingestExpoLocations: vi.fn(),
}));

import {
  createDiagnosticsRepository,
  DIAGNOSTICS_MAX_EVENTS,
  DIAGNOSTICS_MIGRATIONS,
  DIAGNOSTICS_RETENTION_MS,
  type DiagnosticsRepository,
} from "../src/data/diagnostics-repository";
import { runMigrations } from "../src/data/migrations";
import { createDiagnosticsRecorder } from "../src/diagnostics/diagnostics";
import { formatDiagnosticsReport } from "../src/diagnostics/diagnostics-report";
import {
  createDiagnosticEvent,
  sanitizeDetail,
} from "../src/domain/diagnostic-event";
import { describeBatch } from "../src/location/background-location-task";

import { NodeSqliteDatabase } from "./support/node-sqlite-database";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

describe("diagnostic event details", () => {
  it("drops keys that could carry a location", () => {
    expect(
      sanitizeDetail({
        latitude: 52.52,
        longitude: 13.405,
        lng: 1,
        coords: "1,2",
        cellId: "8b1f",
        cell_id: "8b1f",
        h3Index: "8b1f",
        placeName: "Somewhere",
        address: "Somewhere 1",
        receivedCount: 3,
      }),
    ).toEqual({ receivedCount: 3 });
  });

  it("keeps every field of a background batch summary", () => {
    const summary = {
      receivedCount: 3,
      validCount: 3,
      acceptedCount: 2,
      insertedCellCount: 1,
      failed: false,
      oldestAgeS: 90,
      newestAgeS: 30,
      bestAccuracyM: 12,
      worstAccuracyM: 49,
    };

    expect(sanitizeDetail(summary)).toEqual(summary);
  });

  it("keeps only bounded scalar values", () => {
    expect(
      sanitizeDetail({
        ok: true,
        missing: null,
        infinite: Number.POSITIVE_INFINITY,
        nested: { a: 1 },
        list: [1],
        text: "x".repeat(500),
      }),
    ).toEqual({
      ok: true,
      missing: null,
      infinite: null,
      text: "x".repeat(200),
    });
  });
});

describe("diagnostics repository", () => {
  const openDatabases: NodeSqliteDatabase[] = [];

  async function createRepository(): Promise<DiagnosticsRepository> {
    const database = new NodeSqliteDatabase();
    openDatabases.push(database);
    await runMigrations(database, DIAGNOSTICS_MIGRATIONS);
    return createDiagnosticsRepository(database);
  }

  afterEach(() => {
    openDatabases.splice(0).forEach((database) => database.close());
  });

  it("returns events newest first with their details", async () => {
    const repository = await createRepository();
    await repository.record(
      createDiagnosticEvent("process-start", { appState: "background" }, NOW, "p1"),
    );
    await repository.record(
      createDiagnosticEvent("background-batch", { receivedCount: 4 }, NOW + 1_000, "p1"),
    );

    const events = await repository.listNewest(10);

    expect(events.map((event) => event.kind)).toEqual([
      "background-batch",
      "process-start",
    ]);
    expect(events[0]).toEqual({
      recordedAtMs: NOW + 1_000,
      processId: "p1",
      kind: "background-batch",
      detail: { receivedCount: 4 },
    });
  });

  it("prunes events past the retention window and beyond the cap", async () => {
    const repository = await createRepository();
    await repository.record(
      createDiagnosticEvent("process-start", {}, NOW - DIAGNOSTICS_RETENTION_MS - 1, "old"),
    );
    for (let index = 0; index < DIAGNOSTICS_MAX_EVENTS + 5; index += 1) {
      await repository.record(
        createDiagnosticEvent("app-state", { index }, NOW + index, "p1"),
      );
    }

    await repository.prune(NOW);
    const events = await repository.listNewest(DIAGNOSTICS_MAX_EVENTS + 10);

    expect(events).toHaveLength(DIAGNOSTICS_MAX_EVENTS);
    expect(events.some((event) => event.processId === "old")).toBe(false);
    expect(events.at(-1)?.detail).toEqual({ index: 5 });
  });

  it("clears every event", async () => {
    const repository = await createRepository();
    await repository.record(createDiagnosticEvent("app-state", {}, NOW, "p1"));

    await repository.clear();

    await expect(repository.listNewest(10)).resolves.toEqual([]);
  });
});

describe("diagnostics recorder", () => {
  it("keeps recording after the log fails to open", async () => {
    const record = vi.fn(async () => undefined);
    const repository = {
      record,
      listNewest: vi.fn(async () => []),
      prune: vi.fn(),
      clear: vi.fn(),
    } satisfies DiagnosticsRepository;
    const getRepository = vi
      .fn<() => Promise<DiagnosticsRepository>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(repository);
    const recorder = createDiagnosticsRecorder(getRepository, () => NOW, "p1");

    expect(() => recorder.record("process-start")).not.toThrow();
    await expect(recorder.flush()).resolves.toBeUndefined();

    recorder.record("app-state", { state: "background" });
    await recorder.flush();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      recordedAtMs: NOW,
      processId: "p1",
      kind: "app-state",
      detail: { state: "background" },
    });
  });
});

describe("diagnostics report", () => {
  it("lists events oldest first under a header", () => {
    const report = formatDiagnosticsReport(
      [
        createDiagnosticEvent("app-state", { state: "background" }, NOW + 60_000, "p1"),
        createDiagnosticEvent("process-start", { appState: "active" }, NOW, "p1"),
      ],
      { appVersion: "0.4.5-beta.2", platform: "android 35", generatedAtMs: NOW },
    );
    const lines = report.split("\n");

    expect(lines[1]).toBe("App 0.4.5-beta.2 on android 35");
    expect(lines.at(-2)).toContain("[p1] process-start appState=active");
    expect(lines.at(-1)).toContain("[p1] app-state state=background");
  });
});

describe("background batch description", () => {
  function reading(timestamp: number, accuracy: number | null) {
    return {
      coords: {
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        latitude: 52.52,
        longitude: 13.405,
        speed: null,
      },
      timestamp,
    } as Location.LocationObject;
  }

  it("reports timing and accuracy without any position", () => {
    const detail = describeBatch(
      [reading(NOW - 90_000, 12.4), reading(NOW - 30_000, 48.6), reading(NOW - 60_000, null)],
      NOW,
    );

    expect(detail).toEqual({
      oldestAgeS: 90,
      newestAgeS: 30,
      bestAccuracyM: 12,
      worstAccuracyM: 49,
    });
    expect(JSON.stringify(detail)).not.toMatch(/52\.52|13\.405/);
  });
});
