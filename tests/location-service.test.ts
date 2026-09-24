import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ OS: "android" }));

const location = vi.hoisted(() => ({
  Accuracy: { High: 4 },
  ActivityType: { OtherNavigation: 4 },
  PermissionStatus: {
    DENIED: "denied",
    GRANTED: "granted",
    UNDETERMINED: "undetermined",
  },
  getBackgroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getForegroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(),
  isBackgroundLocationAvailableAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("expo-location", () => location);
vi.mock("expo-task-manager", () => ({
  isAvailableAsync: vi.fn(async () => true),
}));
vi.mock("@/src/location/background-location-task", () => ({
  BACKGROUND_LOCATION_TASK_NAME: "test-task",
}));
const recordDiagnostic = vi.hoisted(() => vi.fn());
vi.mock("@/src/diagnostics/diagnostics", () => ({ recordDiagnostic }));
vi.mock("@/src/location/location-ingestion", () => ({
  ingestExpoLocations: vi.fn(async () => undefined),
}));

import { initializeLocationTracking } from "@/src/location/location-service";

const grantedPermission = {
  android: { accuracy: "fine" },
  canAskAgain: true,
  granted: true,
  status: "granted",
};

describe("initializeLocationTracking", () => {
  beforeEach(() => {
    platform.OS = "android";
    location.getForegroundPermissionsAsync.mockResolvedValue(grantedPermission);
    location.getBackgroundPermissionsAsync.mockResolvedValue(grantedPermission);
    location.hasServicesEnabledAsync.mockResolvedValue(true);
    location.isBackgroundLocationAvailableAsync.mockResolvedValue(true);
    location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    location.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));
    location.startLocationUpdatesAsync.mockReset();
    location.startLocationUpdatesAsync.mockResolvedValue(undefined);
    recordDiagnostic.mockReset();
  });

  it("re-registers a restored Android task so its foreground service restarts", async () => {
    const state = await initializeLocationTracking();

    expect(location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      "test-task",
      expect.objectContaining({ foregroundService: expect.any(Object) }),
    );
    expect(state.trackingMode).toBe("background");
    expect(state.error).toBeNull();
    expect(recordDiagnostic).toHaveBeenCalledWith("task-reregister", {
      ok: true,
    });
    expect(recordDiagnostic).toHaveBeenCalledWith(
      "tracking-state",
      expect.objectContaining({
        operation: "initialize",
        mode: "background",
        background: "granted",
      }),
    );
  });

  it("keeps background tracking when re-registering fails", async () => {
    location.startLocationUpdatesAsync.mockRejectedValue(
      new Error("not foregrounded"),
    );

    const state = await initializeLocationTracking();

    expect(state.trackingMode).toBe("background");
    expect(state.error).toBeNull();
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith("task-reregister", {
      ok: false,
      error: "not foregrounded",
    });
  });

  it("leaves an already running iOS task untouched", async () => {
    platform.OS = "ios";

    const state = await initializeLocationTracking();

    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(state.trackingMode).toBe("background");
  });
});
