import Storage from "expo-sqlite/kv-store";
import { PermissionsAndroid, Platform } from "react-native";

import { YonderDeviceHealth } from "@/modules/yonder-device-health";
import { describeBackupCause } from "@/src/data/backup-failure";
import { recordConfirmedDiagnostic, recordDiagnostic } from "@/src/diagnostics/diagnostics";
import { formatDiagnosticTime } from "@/src/diagnostics/diagnostics-report";
import { parseCrashLog } from "@/src/domain/crash-log";
import {
  crashReachedJavaScript,
  describeExitReason,
  describeImportance,
  describeStandbyBucket,
  selectNewExits,
  shouldNotifyBatteryWarning,
  toBatteryState,
  type PowerState,
} from "@/src/domain/device-health";

const LAST_EXIT_KEY = "diagnostics-last-process-exit-ms";
const JS_START_KEY = "diagnostics-js-start-ms";
const LAST_CRASH_LOG_KEY = "diagnostics-last-crash-log-ms";
const PENDING_JS_ERROR_KEY = "diagnostics-pending-js-error";
const WARNED_AT_KEY = "battery-warning-notified-at-ms";
const NOTIFICATION_PERMISSION_ASKED_KEY = "notification-permission-asked";

const BATTERY_WARNING_NOTIFICATION_ID = 7301;
const BATTERY_WARNING_TITLE = "Battery saving can stop Yonder";
const BATTERY_WARNING_BODY =
  "Android may stop recording places while Yonder is in the background. Tap to allow unrestricted battery use.";

/** Null where the native module is missing (iOS, web, older builds). */
export function readPowerState(): PowerState | null {
  if (!YonderDeviceHealth) return null;
  try {
    const native = YonderDeviceHealth.getPowerState();
    return {
      battery: toBatteryState(native.ignoringBatteryOptimizations, native.backgroundRestricted),
      standbyBucket: describeStandbyBucket(native.standbyBucket),
    };
  } catch {
    return null;
  }
}

/** Diagnostics fields for the current battery state; empty where unknown. */
export function describePowerForDiagnostics(): Record<string, string | null> {
  const state = readPowerState();
  return state ? { battery: state.battery, standbyBucket: state.standbyBucket } : {};
}

async function recordAll(
  kind: Parameters<typeof recordConfirmedDiagnostic>[0],
  details: readonly Record<string, unknown>[],
): Promise<boolean> {
  const saved = await Promise.all(details.map((detail) => recordConfirmedDiagnostic(kind, detail)));
  return saved.every(Boolean);
}

function readNumber(key: string): number | null {
  const stored = Storage.getItemSync(key);
  const value = stored === null ? null : Number(stored);
  return value !== null && Number.isFinite(value) ? value : null;
}

/**
 * Records each process exit Android reported since the newest one already
 * recorded. Runs at every process start, headless ones included.
 */
export async function recordProcessExits(): Promise<void> {
  if (!YonderDeviceHealth) return;
  try {
    const exits = selectNewExits(YonderDeviceHealth.getProcessExits(), readNumber(LAST_EXIT_KEY));
    const newest = exits.at(-1);
    if (!newest) return;
    const saved = await recordAll("process-exit", exits.map((exit) => ({
      exitedAt: formatDiagnosticTime(exit.timestampMs),
      reason: describeExitReason(exit.reason),
      importance: describeImportance(exit.importance),
      status: exit.status,
      pssMb: Math.round(exit.pssKb / 1024),
      rssMb: Math.round(exit.rssKb / 1024),
      description: exit.description ? describeBackupCause(exit.description) : null,
    })));
    if (saved) Storage.setItemSync(LAST_EXIT_KEY, String(newest.timestampMs));
  } catch {
    // Diagnostics must never disturb the code that records them.
  }
}

/**
 * Writes this JavaScript start synchronously, so it survives a crash moments
 * later, and returns the previous one.
 */
export function markJsStart(nowMs = Date.now()): number | null {
  try {
    const previous = readNumber(JS_START_KEY);
    Storage.setItemSync(JS_START_KEY, String(nowMs));
    return previous;
  } catch {
    return null;
  }
}

/** Records each crash the native crash recorder kept, oldest first. */
export async function recordCrashes(previousJsStartMs: number | null): Promise<void> {
  if (!YonderDeviceHealth) return;
  try {
    const crashes = YonderDeviceHealth.peekCrashes();
    if (crashes.length === 0) return;
    const saved = await recordAll("native-crash", crashes.map((crash) => ({
      crashedAt: formatDiagnosticTime(crash.atMs),
      processStartedAt: crash.processStartedAtMs > 0 ? formatDiagnosticTime(crash.processStartedAtMs) : null,
      jsStarted: crashReachedJavaScript(crash, previousJsStartMs),
      thread: crash.thread,
      exception: describeBackupCause(crash.exception),
      cause: crash.cause === null ? null : describeBackupCause(crash.cause),
      ...Object.fromEntries(crash.frames.map((frame, index) => [`frame${index + 1}`, frame])),
    })));
    if (saved) YonderDeviceHealth.clearCrashesThrough(Math.max(...crashes.map((crash) => crash.atMs)));
  } catch {
    // Diagnostics must never disturb the code that records them.
  }
}

/**
 * Records each Yonder crash in Android's crash log newer than the newest one
 * already recorded, including crashes from before any of Yonder's code ran.
 */
export async function recordCrashLog(): Promise<void> {
  if (!YonderDeviceHealth) return;
  try {
    const lastRecordedMs = readNumber(LAST_CRASH_LOG_KEY);
    const entries = parseCrashLog(await YonderDeviceHealth.readCrashLog())
      .filter((entry) => lastRecordedMs === null || entry.atMs > lastRecordedMs);
    if (entries.length === 0) return;
    const saved = await recordAll("crash-log", entries.map((entry) => ({
      crashedAt: formatDiagnosticTime(entry.atMs),
      ...Object.fromEntries(entry.lines.map((line, index) => [`line${index + 1}`, describeBackupCause(line)])),
    })));
    if (saved) Storage.setItemSync(LAST_CRASH_LOG_KEY, String(Math.max(...entries.map((entry) => entry.atMs))));
  } catch {
    // Diagnostics must never disturb the code that records them.
  }
}

/**
 * Records each restart of the location task after a reboot or app update,
 * noted natively because a restart runs no JavaScript until a location arrives.
 */
export async function recordTaskRestores(): Promise<void> {
  if (!YonderDeviceHealth) return;
  try {
    const restores = YonderDeviceHealth.peekTaskRestores();
    if (restores.length === 0) return;
    const saved = await recordAll("task-restore", restores.map((restore) => ({
      restoredAt: formatDiagnosticTime(restore.atMs),
      trigger: restore.trigger,
      outcome: restore.outcome,
    })));
    if (saved) YonderDeviceHealth.clearTaskRestoresThrough(Math.max(...restores.map((restore) => restore.atMs)));
  } catch {
    // Diagnostics must never disturb the code that records them.
  }
}

/** Keeps a fatal JavaScript error synchronously until its event is saved. */
export function keepFatalJsError(detail: Record<string, string | boolean>): void {
  try {
    Storage.setItemSync(PENDING_JS_ERROR_KEY, JSON.stringify(detail));
  } catch {
    // Diagnostics must never disturb the code that records them.
  }
}

export function forgetFatalJsError(): void {
  try {
    Storage.removeItemSync(PENDING_JS_ERROR_KEY);
  } catch {
    // Diagnostics must never disturb the code that records them.
  }
}

/** Records a fatal JavaScript error whose process died before saving it. */
export async function recordKeptFatalJsError(): Promise<void> {
  try {
    const stored = Storage.getItemSync(PENDING_JS_ERROR_KEY);
    if (stored === null) return;
    const parsed: unknown = JSON.parse(stored);
    const detail = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    if (await recordConfirmedDiagnostic("js-error", { ...detail, recovered: true })) forgetFatalJsError();
  } catch {
    // Diagnostics must never disturb the code that records them.
  }
}

/**
 * Posts the battery warning notification when battery saving can stop
 * background tracking, at most once a day.
 */
export function checkBatteryWarning(backgroundTracking: boolean, nowMs = Date.now()): void {
  if (!YonderDeviceHealth) return;
  try {
    const state = readPowerState();
    if (!state) return;
    if (state.battery === "unrestricted") {
      Storage.removeItemSync(WARNED_AT_KEY);
      return;
    }
    const stored = Storage.getItemSync(WARNED_AT_KEY);
    const lastNotifiedAtMs = stored === null ? null : Number(stored);
    if (!shouldNotifyBatteryWarning({
      battery: state.battery,
      backgroundTracking,
      lastNotifiedAtMs: Number.isFinite(lastNotifiedAtMs) ? lastNotifiedAtMs : null,
      nowMs,
    })) return;
    const posted = YonderDeviceHealth.showNotification(
      BATTERY_WARNING_NOTIFICATION_ID,
      BATTERY_WARNING_TITLE,
      BATTERY_WARNING_BODY,
      "yonder://settings",
    );
    // Without notification permission this is retried, and not recorded, on
    // every check.
    if (!posted) return;
    recordDiagnostic("battery-warning", { battery: state.battery });
    Storage.setItemSync(WARNED_AT_KEY, String(nowMs));
  } catch {
    // A missing warning must never disturb tracking.
  }
}

/** Opens the system screen that lifts the current battery restriction. */
export function openBatterySettings(): boolean {
  if (!YonderDeviceHealth) return false;
  const state = readPowerState();
  try {
    return YonderDeviceHealth.openBatterySettings(state?.battery === "restricted");
  } catch {
    return false;
  }
}

/**
 * Asks once for the Android 13+ notification permission, which the battery
 * warning and the tracking notification need to be visible. Call only while
 * the app is in the foreground.
 */
export async function requestNotificationPermissionOnce(): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33 || !YonderDeviceHealth) return;
  try {
    if (YonderDeviceHealth.canPostNotifications()) return;
    if (Storage.getItemSync(NOTIFICATION_PERMISSION_ASKED_KEY) !== null) return;
    Storage.setItemSync(NOTIFICATION_PERMISSION_ASKED_KEY, "1");
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    recordDiagnostic("notification-permission", { result });
  } catch {
    // Tracking works without notifications.
  }
}
