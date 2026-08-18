import { describe, expect, it } from "vitest";

import {
  createLocationSampleFingerprint,
  validateNormalizedLocationSample,
  type ValidatedLocationSample,
} from "../src/domain/location-sample";

describe("validateNormalizedLocationSample", () => {
  it("normalizes a valid timestamp and signed zero", () => {
    const result = validateNormalizedLocationSample({
      source: "live-foreground",
      recordedAt: "2026-08-12T14:15:16+02:00",
      latitude: -0,
      longitude: 12.25,
      horizontalAccuracyM: 9,
    });

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;

    expect(result.sample.recordedAt).toBe("2026-08-12T12:15:16.000Z");
    expect(result.sample.recordedAtMs).toBe(1_786_536_916_000);
    expect(Object.is(result.sample.latitude, -0)).toBe(false);
    expect(result.sample.fingerprint).toMatch(/^location-sample-v1:/);
  });

  it.each([
    ["non-object", null, "invalid-sample"],
    [
      "unsupported source",
      { source: "other", recordedAt: "2026-01-01T00:00:00Z", latitude: 0, longitude: 0 },
      "invalid-source",
    ],
    [
      "timezone-free timestamp",
      { source: "live-background", recordedAt: "2026-01-01T00:00:00", latitude: 0, longitude: 0 },
      "invalid-timestamp",
    ],
    [
      "nonexistent calendar day",
      { source: "live-background", recordedAt: "2026-02-29T00:00:00Z", latitude: 0, longitude: 0 },
      "invalid-timestamp",
    ],
    [
      "latitude outside WGS84",
      { source: "live-background", recordedAt: "2026-01-01T00:00:00Z", latitude: 91, longitude: 0 },
      "invalid-latitude",
    ],
    [
      "non-finite longitude",
      { source: "live-background", recordedAt: "2026-01-01T00:00:00Z", latitude: 0, longitude: Number.NaN },
      "invalid-longitude",
    ],
    [
      "negative accuracy",
      { source: "live-background", recordedAt: "2026-01-01T00:00:00Z", latitude: 0, longitude: 0, horizontalAccuracyM: -1 },
      "invalid-accuracy",
    ],
    [
      "empty external id",
      { source: "bump-import", recordedAt: "2026-01-01T00:00:00Z", latitude: 0, longitude: 0, sourceRecordId: "" },
      "invalid-source-record-id",
    ],
  ])("rejects %s", (_name, candidate, expectedCode) => {
    const result = validateNormalizedLocationSample(candidate);
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.errors.map(({ code }) => code)).toContain(expectedCode);
  });

  it("applies the live accuracy threshold without imposing it on imported history", () => {
    const common = {
      recordedAt: "2026-01-01T00:00:00Z",
      latitude: 10,
      longitude: 20,
      horizontalAccuracyM: 51,
    };

    const live = validateNormalizedLocationSample({
      ...common,
      source: "live-foreground",
    });
    const imported = validateNormalizedLocationSample({
      ...common,
      source: "bump-import",
    });

    expect(live.accepted).toBe(false);
    expect(imported.accepted).toBe(true);
  });
});

describe("createLocationSampleFingerprint", () => {
  const base: Omit<ValidatedLocationSample, "fingerprint"> = {
    source: "bump-import",
    recordedAt: "2026-01-01T00:00:00.000Z",
    recordedAtMs: 1_767_225_600_000,
    latitude: 10.5,
    longitude: -20.25,
    horizontalAccuracyM: 4,
  };

  it("is stable for an equivalent normalized sample", () => {
    expect(createLocationSampleFingerprint({ ...base })).toBe(
      createLocationSampleFingerprint({ ...base }),
    );
  });

  it("keeps arbitrary identifiers delimiter-safe", () => {
    const first = createLocationSampleFingerprint({
      ...base,
      sourceRecordId: 'record","batch',
    });
    const second = createLocationSampleFingerprint({
      ...base,
      sourceRecordId: 'record\\",","batch',
    });

    expect(first).not.toBe(second);
    expect(() => JSON.parse(first.slice("location-sample-v1:".length))).not.toThrow();
  });

  it("does not make transient import-batch metadata part of sample identity", () => {
    expect(
      createLocationSampleFingerprint({ ...base, importBatchId: "first-run" }),
    ).toBe(
      createLocationSampleFingerprint({ ...base, importBatchId: "retry-run" }),
    );
  });
});
