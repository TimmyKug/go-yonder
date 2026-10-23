import Storage from "expo-sqlite/kv-store";
import { PermissionsAndroid, Platform } from "react-native";

import { YonderDeviceHealth } from "@/modules/yonder-device-health";
import { describeBackupCause } from "@/src/data/backup-failure";
import { recordDiagnostic } from "@/src/diagnostics/diagnostics";
import { formatDiagnosticTime } from "@/src/diagnostics/diagnostics-report";
import {
  describeExitReason,
  describeImportance,
  describeStandbyBucket,
  selectNewExits,
  shouldNotifyBatteryWarning,
  toBatteryState,
  type PowerState,
} from "@/src/domain/device-health";

const LAST_EXIT_KEY = "diagnostics-last-process-exit-ms";
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

/**
 * Records each process exit Android reported since the newest one already
 * recorded. Runs at every process start, headless ones included.
 */
export function recordProcessExits(): void {
  if (!YonderDeviceHealth) return;
  try {
    const stored = Storage.getItemSync(LAST_EXIT_KEY);
    const lastRecordedMs = stored === null ? null : Number(stored);
    const exits = selectNewExits(
      YonderDeviceHealth.getProcessExits(),
      Number.isFinite(lastRecordedMs) ? lastRecordedMs : null,
    );
    for (const exit of exits) {
      recordDiagnostic("process-exit", {
        exitedAt: formatDiagnosticTime(exit.timestampMs),
        reason: describeExitReason(exit.reason),
        importance: describeImportance(exit.importance),
        status: exit.status,
        pssMb: Math.round(exit.pssKb / 1024),
        rssMb: Math.round(exit.rssKb / 1024),
        description: exit.description ? describeBackupCause(exit.description) : null,
      });
    }
    const newest = exits.at(-1);
    if (newest) Storage.setItemSync(LAST_EXIT_KEY, String(newest.timestampMs));
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
