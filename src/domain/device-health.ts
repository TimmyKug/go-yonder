export type BatteryState = "unrestricted" | "optimized" | "restricted";

export type PowerState = Readonly<{
  battery: BatteryState;
  standbyBucket: string | null;
}>;

export type ProcessExit = Readonly<{
  timestampMs: number;
  reason: number;
  status: number;
  importance: number;
  pssKb: number;
  rssKb: number;
  description: string | null;
}>;

// ApplicationExitInfo.REASON_* values.
const EXIT_REASONS: Readonly<Record<number, string>> = {
  0: "unknown",
  1: "exit-self",
  2: "signaled",
  3: "low-memory",
  4: "crash",
  5: "crash-native",
  6: "anr",
  7: "initialization-failure",
  8: "permission-change",
  9: "excessive-resource-usage",
  10: "user-requested",
  11: "user-stopped",
  12: "dependency-died",
  13: "other",
  14: "freezer",
  15: "package-state-change",
  16: "package-updated",
};

// ActivityManager.RunningAppProcessInfo.IMPORTANCE_* values.
const IMPORTANCES: Readonly<Record<number, string>> = {
  100: "foreground",
  125: "foreground-service",
  150: "top-sleeping",
  200: "visible",
  230: "perceptible",
  300: "service",
  325: "top-sleeping",
  350: "cant-save-state",
  400: "cached",
  1000: "gone",
};

// UsageStatsManager.STANDBY_BUCKET_* values.
const STANDBY_BUCKETS: Readonly<Record<number, string>> = {
  5: "exempted",
  10: "active",
  20: "working-set",
  30: "frequent",
  40: "rare",
  45: "restricted",
  50: "never",
};

export function toBatteryState(
  ignoringBatteryOptimizations: boolean,
  backgroundRestricted: boolean,
): BatteryState {
  if (backgroundRestricted) return "restricted";
  return ignoringBatteryOptimizations ? "unrestricted" : "optimized";
}

export function describeStandbyBucket(bucket: number | null): string | null {
  return bucket === null ? null : (STANDBY_BUCKETS[bucket] ?? String(bucket));
}

export function describeExitReason(reason: number): string {
  return EXIT_REASONS[reason] ?? String(reason);
}

export function describeImportance(importance: number): string {
  return IMPORTANCES[importance] ?? String(importance);
}

/** Exits newer than the newest one already recorded, oldest first. */
export function selectNewExits(
  exits: readonly ProcessExit[],
  lastRecordedMs: number | null,
): ProcessExit[] {
  return exits
    .filter((exit) => lastRecordedMs === null || exit.timestampMs > lastRecordedMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export const BATTERY_WARNING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Warn about battery saving only while it can stop background tracking, at
 * most once per interval.
 */
export function shouldNotifyBatteryWarning(input: {
  battery: BatteryState;
  backgroundTracking: boolean;
  lastNotifiedAtMs: number | null;
  nowMs: number;
}): boolean {
  if (!input.backgroundTracking || input.battery === "unrestricted") return false;
  return (
    input.lastNotifiedAtMs === null ||
    input.nowMs - input.lastNotifiedAtMs >= BATTERY_WARNING_INTERVAL_MS ||
    input.nowMs < input.lastNotifiedAtMs
  );
}
