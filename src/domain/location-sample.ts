import { MAX_LIVE_HORIZONTAL_ACCURACY_M } from "../config/tessera-config";

export const LOCATION_SOURCES = [
  "live-foreground",
  "live-background",
  "external-import",
] as const;

export type LocationSource = (typeof LOCATION_SOURCES)[number];

export type NormalizedLocationSample = {
  source: LocationSource;
  sourceRecordId?: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  horizontalAccuracyM?: number;
  importBatchId?: string;
};

export type ValidatedLocationSample = NormalizedLocationSample & {
  /** A canonical UTC representation of `recordedAt`. */
  recordedAt: string;
  recordedAtMs: number;
  fingerprint: string;
};

export type LocationSampleValidationErrorCode =
  | "invalid-sample"
  | "invalid-source"
  | "invalid-timestamp"
  | "invalid-latitude"
  | "invalid-longitude"
  | "invalid-accuracy"
  | "accuracy-too-low"
  | "invalid-source-record-id"
  | "invalid-import-batch-id";

export type LocationSampleValidationError = {
  code: LocationSampleValidationErrorCode;
  message: string;
};

export type LocationSampleValidationResult =
  | { accepted: true; sample: ValidatedLocationSample }
  | { accepted: false; errors: readonly LocationSampleValidationError[] };

export type LocationSampleValidationPolicy = {
  maxLiveHorizontalAccuracyM?: number;
};

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const MAX_OPTIONAL_ID_LENGTH = 4_096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocationSource(value: unknown): value is LocationSource {
  return (
    typeof value === "string" &&
    (LOCATION_SOURCES as readonly string[]).includes(value)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return days[month - 1] ?? 0;
}

function parseIsoTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) ? timestamp : undefined;
}

function validateOptionalId(
  value: unknown,
  code: "invalid-source-record-id" | "invalid-import-batch-id",
  fieldName: string,
): LocationSampleValidationError | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_OPTIONAL_ID_LENGTH
  ) {
    return {
      code,
      message: `${fieldName} must be a non-empty string of at most ${MAX_OPTIONAL_ID_LENGTH} characters`,
    };
  }

  return undefined;
}

function canonicalNumber(value: number): string {
  return Object.is(value, -0) ? "0" : value.toString();
}

/**
 * Builds an exact, versioned identity from normalized fields.
 *
 * JSON array encoding makes user-provided identifiers delimiter-safe. Keeping the
 * canonical payload, rather than using a short non-cryptographic hash, also avoids
 * hash collisions without relying on Node-only crypto APIs.
 */
export function createLocationSampleFingerprint(
  sample: Omit<ValidatedLocationSample, "fingerprint">,
): string {
  return `location-sample-v1:${JSON.stringify([
    sample.source,
    sample.sourceRecordId ?? null,
    sample.recordedAtMs.toString(),
    canonicalNumber(sample.latitude),
    canonicalNumber(sample.longitude),
    sample.horizontalAccuracyM === undefined
      ? null
      : canonicalNumber(sample.horizontalAccuracyM),
  ])}`;
}

export function validateNormalizedLocationSample(
  candidate: unknown,
  policy: LocationSampleValidationPolicy = {
    maxLiveHorizontalAccuracyM: MAX_LIVE_HORIZONTAL_ACCURACY_M,
  },
): LocationSampleValidationResult {
  if (!isRecord(candidate)) {
    return {
      accepted: false,
      errors: [{ code: "invalid-sample", message: "sample must be an object" }],
    };
  }

  const errors: LocationSampleValidationError[] = [];
  const source = candidate.source;
  const recordedAtMs = parseIsoTimestamp(candidate.recordedAt);

  if (!isLocationSource(source)) {
    errors.push({ code: "invalid-source", message: "source is not supported" });
  }

  if (recordedAtMs === undefined) {
    errors.push({
      code: "invalid-timestamp",
      message: "recordedAt must be a valid ISO-8601 timestamp with a timezone",
    });
  }

  if (
    !isFiniteNumber(candidate.latitude) ||
    candidate.latitude < -90 ||
    candidate.latitude > 90
  ) {
    errors.push({
      code: "invalid-latitude",
      message: "latitude must be a finite number between -90 and 90",
    });
  }

  if (
    !isFiniteNumber(candidate.longitude) ||
    candidate.longitude < -180 ||
    candidate.longitude > 180
  ) {
    errors.push({
      code: "invalid-longitude",
      message: "longitude must be a finite number between -180 and 180",
    });
  }

  const accuracy = candidate.horizontalAccuracyM;
  if (
    accuracy !== undefined &&
    (!isFiniteNumber(accuracy) || accuracy < 0)
  ) {
    errors.push({
      code: "invalid-accuracy",
      message: "horizontalAccuracyM must be a finite non-negative number",
    });
  } else if (
    isLocationSource(source) &&
    source !== "external-import" &&
    accuracy !== undefined &&
    policy.maxLiveHorizontalAccuracyM !== undefined &&
    accuracy > policy.maxLiveHorizontalAccuracyM
  ) {
    errors.push({
      code: "accuracy-too-low",
      message: "live sample accuracy is outside the accepted threshold",
    });
  }

  const sourceRecordIdError = validateOptionalId(
    candidate.sourceRecordId,
    "invalid-source-record-id",
    "sourceRecordId",
  );
  if (sourceRecordIdError) {
    errors.push(sourceRecordIdError);
  }

  const importBatchIdError = validateOptionalId(
    candidate.importBatchId,
    "invalid-import-batch-id",
    "importBatchId",
  );
  if (importBatchIdError) {
    errors.push(importBatchIdError);
  }

  if (errors.length > 0) {
    return { accepted: false, errors };
  }

  // The checks above narrow these values at runtime. Explicit locals keep the
  // returned object free of unrelated properties from untrusted import records.
  const validatedWithoutFingerprint: Omit<
    ValidatedLocationSample,
    "fingerprint"
  > = {
    source: source as LocationSource,
    recordedAt: new Date(recordedAtMs as number).toISOString(),
    recordedAtMs: recordedAtMs as number,
    latitude: Object.is(candidate.latitude, -0)
      ? 0
      : (candidate.latitude as number),
    longitude: Object.is(candidate.longitude, -0)
      ? 0
      : (candidate.longitude as number),
    ...(candidate.sourceRecordId === undefined
      ? {}
      : { sourceRecordId: candidate.sourceRecordId as string }),
    ...(accuracy === undefined
      ? {}
      : { horizontalAccuracyM: accuracy as number }),
    ...(candidate.importBatchId === undefined
      ? {}
      : { importBatchId: candidate.importBatchId as string }),
  };

  return {
    accepted: true,
    sample: {
      ...validatedWithoutFingerprint,
      fingerprint: createLocationSampleFingerprint(validatedWithoutFingerprint),
    },
  };
}
