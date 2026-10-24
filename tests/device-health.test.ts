import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  canPostNotifications: vi.fn(() => true),
  getPowerState: vi.fn(),
  getProcessExits: vi.fn(),
  openBatterySettings: vi.fn(() => true),
  showNotification: vi.fn(() => true),
  takeCrashes: vi.fn(),
  takeTaskRestores: vi.fn(),
}));
const storage = vi.hoisted(() => new Map<string, string>());
const recordDiagnostic = vi.hoisted(() => vi.fn());
const requestPermission = vi.hoisted(() => vi.fn(async () => "granted"));
const platform = vi.hoisted(() => ({ OS: "android", Version: 36 }));

vi.mock("@/modules/yonder-device-health", () => ({ YonderDeviceHealth: native }));
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => storage.get(key) ?? null,
    removeItemSync: (key: string) => storage.delete(key),
    setItemSync: (key: string, value: string) => storage.set(key, value),
  },
}));
vi.mock("react-native", () => ({
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS" },
    request: requestPermission,
  },
  Platform: platform,
}));
vi.mock("@/src/diagnostics/diagnostics", () => ({ recordDiagnostic }));

import {
  checkBatteryWarning,
  describePowerForDiagnostics,
  markJsStart,
  openBatterySettings,
  recordCrashes,
  recordProcessExits,
  recordTaskRestores,
  requestNotificationPermissionOnce,
} from "@/src/device-health/device-health";
import { installJsErrorRecorder } from "@/src/diagnostics/js-errors";
import {
  BATTERY_WARNING_INTERVAL_MS,
  crashReachedJavaScript,
  describeExitReason,
  describeImportance,
  selectNewExits,
  shouldNotifyBatteryWarning,
  toBatteryState,
} from "@/src/domain/device-health";
import { sanitizeDetail } from "@/src/domain/diagnostic-event";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

function exit(timestampMs: number, reason = 3) {
  return {
    description: "stop com.example due to /data/app/x 52.5200 kill",
    importance: 125,
    pssKb: 204_800,
    reason,
    rssKb: 307_200,
    status: 0,
    timestampMs,
  };
}

function power(ignoringBatteryOptimizations: boolean, backgroundRestricted = false) {
  native.getPowerState.mockReturnValue({
    backgroundRestricted,
    ignoringBatteryOptimizations,
    standbyBucket: 10,
  });
}

beforeEach(() => {
  storage.clear();
  recordDiagnostic.mockReset();
  native.showNotification.mockReset();
  native.showNotification.mockReturnValue(true);
  native.canPostNotifications.mockReturnValue(true);
  native.openBatterySettings.mockClear();
  requestPermission.mockClear();
  platform.Version = 36;
  power(false);
});

describe("battery state", () => {
  it("maps Android's two flags to the three settings users see", () => {
    expect(toBatteryState(true, false)).toBe("unrestricted");
    expect(toBatteryState(false, false)).toBe("optimized");
    expect(toBatteryState(false, true)).toBe("restricted");
  });

  it("survives the diagnostics sanitizer", () => {
    power(false);
    const detail = describePowerForDiagnostics();
    expect(sanitizeDetail(detail)).toEqual({ battery: "optimized", standbyBucket: "active" });
  });

  it("opens the app settings page for restricted apps, which the exemption dialog cannot lift", () => {
    power(false, true);
    openBatterySettings();
    expect(native.openBatterySettings).toHaveBeenCalledWith(true);
    power(false);
    openBatterySettings();
    expect(native.openBatterySettings).toHaveBeenLastCalledWith(false);
  });
});

describe("process exits", () => {
  it("names Android's exit reasons and importances", () => {
    expect(describeExitReason(3)).toBe("low-memory");
    expect(describeExitReason(5)).toBe("crash-native");
    expect(describeExitReason(99)).toBe("99");
    expect(describeImportance(125)).toBe("foreground-service");
    expect(describeImportance(400)).toBe("cached");
  });

  it("selects exits newer than the last recorded one, oldest first", () => {
    const exits = [exit(NOW), exit(NOW - 2_000), exit(NOW - 1_000)];
    expect(selectNewExits(exits, null).map((e) => e.timestampMs)).toEqual([NOW - 2_000, NOW - 1_000, NOW]);
    expect(selectNewExits(exits, NOW - 1_000).map((e) => e.timestampMs)).toEqual([NOW]);
  });

  it("records each new exit once, scrubbed and in megabytes", () => {
    native.getProcessExits.mockReturnValue([exit(NOW - 1_000), exit(NOW, 10)]);
    recordProcessExits();
    recordProcessExits();

    expect(recordDiagnostic).toHaveBeenCalledTimes(2);
    expect(recordDiagnostic).toHaveBeenNthCalledWith(1, "process-exit", expect.objectContaining({
      description: "stop com.example due to <path> <number> kill",
      importance: "foreground-service",
      pssMb: 200,
      reason: "low-memory",
      rssMb: 300,
    }));
    expect(recordDiagnostic).toHaveBeenNthCalledWith(2, "process-exit", expect.objectContaining({
      reason: "user-requested",
    }));
    const detail = recordDiagnostic.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(sanitizeDetail(detail))).toEqual(Object.keys(detail));
  });
});

describe("native crashes", () => {
  const crash = {
    atMs: NOW,
    cause: "java.lang.IllegalStateException: bad value 13.4050 in /data/user/0/app",
    exception: "java.lang.RuntimeException: wrapped",
    frames: ["a.b.c(SourceFile:12)", "d.e.f(SourceFile:3)"],
    processStartedAtMs: NOW - 2_000,
    thread: "main",
  };

  it("tells whether the crashed process reached JavaScript", () => {
    expect(crashReachedJavaScript(crash, NOW - 1_000)).toBe(true);
    expect(crashReachedJavaScript(crash, NOW - 5_000)).toBe(false);
    expect(crashReachedJavaScript(crash, null)).toBeNull();
    expect(crashReachedJavaScript({ ...crash, processStartedAtMs: 0 }, NOW)).toBeNull();
  });

  it("returns the previous JavaScript start and keeps this one", () => {
    expect(markJsStart(NOW)).toBeNull();
    expect(markJsStart(NOW + 1_000)).toBe(NOW);
  });

  it("records each crash with a scrubbed cause and numbered frames the sanitizer keeps", () => {
    native.takeCrashes.mockReturnValue([crash]);
    recordCrashes(NOW - 1_000);

    expect(recordDiagnostic).toHaveBeenCalledWith("native-crash", expect.objectContaining({
      cause: "java.lang.IllegalStateException: bad value <number> in <path>",
      exception: "java.lang.RuntimeException: wrapped",
      frame1: "a.b.c(SourceFile:12)",
      frame2: "d.e.f(SourceFile:3)",
      jsStarted: true,
      thread: "main",
    }));
    const detail = recordDiagnostic.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(sanitizeDetail(detail))).toEqual(Object.keys(detail));
  });
});

describe("task restores", () => {
  it("records each restart the native side noted, keeping every field", () => {
    native.takeTaskRestores.mockReturnValue([
      { atMs: NOW, outcome: "service-started", trigger: "package-replaced" },
      { atMs: NOW + 1_000, outcome: "start-not-allowed", trigger: "boot" },
    ]);
    recordTaskRestores();

    expect(recordDiagnostic).toHaveBeenCalledTimes(2);
    expect(recordDiagnostic).toHaveBeenNthCalledWith(1, "task-restore", expect.objectContaining({
      outcome: "service-started",
      trigger: "package-replaced",
    }));
    const detail = recordDiagnostic.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(sanitizeDetail(detail))).toEqual(["restoredAt", "trigger", "outcome"]);
  });
});

describe("battery warning notification", () => {
  it("is due only while background tracking can be stopped, once per interval", () => {
    const base = { backgroundTracking: true, battery: "optimized" as const, lastNotifiedAtMs: null, nowMs: NOW };
    expect(shouldNotifyBatteryWarning(base)).toBe(true);
    expect(shouldNotifyBatteryWarning({ ...base, battery: "unrestricted" })).toBe(false);
    expect(shouldNotifyBatteryWarning({ ...base, backgroundTracking: false })).toBe(false);
    expect(shouldNotifyBatteryWarning({ ...base, lastNotifiedAtMs: NOW - 1_000 })).toBe(false);
    expect(shouldNotifyBatteryWarning({ ...base, lastNotifiedAtMs: NOW - BATTERY_WARNING_INTERVAL_MS })).toBe(true);
  });

  it("posts once a day and again at once after the app was unrestricted in between", () => {
    checkBatteryWarning(true, NOW);
    checkBatteryWarning(true, NOW + 60_000);
    expect(native.showNotification).toHaveBeenCalledTimes(1);
    expect(native.showNotification).toHaveBeenCalledWith(
      expect.any(Number), expect.any(String), expect.any(String), "yonder://settings",
    );

    power(true);
    checkBatteryWarning(true, NOW + 120_000);
    power(false);
    checkBatteryWarning(true, NOW + 180_000);
    expect(native.showNotification).toHaveBeenCalledTimes(2);
  });

  it("does not post while background tracking is off", () => {
    checkBatteryWarning(false, NOW);
    expect(native.showNotification).not.toHaveBeenCalled();
  });

  it("retries later when the notification could not be posted", () => {
    native.showNotification.mockReturnValue(false);
    checkBatteryWarning(true, NOW);
    native.showNotification.mockReturnValue(true);
    checkBatteryWarning(true, NOW + 60_000);
    expect(native.showNotification).toHaveBeenCalledTimes(2);
    expect(recordDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("asks for the notification permission only once", async () => {
    native.canPostNotifications.mockReturnValue(false);
    await requestNotificationPermissionOnce();
    await requestNotificationPermissionOnce();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not ask before Android 13, where notifications need no permission", async () => {
    native.canPostNotifications.mockReturnValue(false);
    platform.Version = 32;
    await requestNotificationPermissionOnce();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("JavaScript error recorder", () => {
  function install(flush: () => Promise<void>) {
    const previous = vi.fn();
    let handler: ((error: unknown, isFatal?: boolean) => void) | undefined;
    const record = vi.fn();
    installJsErrorRecorder(
      { getGlobalHandler: () => previous, setGlobalHandler: (next) => { handler = next; } },
      record,
      flush,
    );
    return { handler: handler!, previous, record };
  }

  it("records a scrubbed error and passes a non-fatal one straight on", () => {
    const { handler, previous, record } = install(async () => undefined);
    const error = new TypeError("bad value 13.4050 at /data/file");
    handler(error, false);
    expect(record).toHaveBeenCalledWith({ fatal: false, message: "bad value <number> at <path>", name: "TypeError" });
    expect(previous).toHaveBeenCalledWith(error, false);
  });

  it("waits for the write before handing a fatal error on", async () => {
    let finish!: () => void;
    const { handler, previous } = install(() => new Promise((resolve) => { finish = resolve; }));
    handler(new Error("boom"), true);
    await Promise.resolve();
    expect(previous).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(previous).toHaveBeenCalledTimes(1));
  });

  it("hands a fatal error on after a timeout when the write hangs", async () => {
    vi.useFakeTimers();
    try {
      const { handler, previous } = install(() => new Promise(() => undefined));
      handler(new Error("boom"), true);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(previous).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
