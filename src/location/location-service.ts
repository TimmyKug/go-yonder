import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { BACKGROUND_LOCATION_TASK_NAME } from "./background-location-task";
import { ingestExpoLocations } from "./location-ingestion";
import {
  getLocationSnapshot,
  subscribeToLocationState,
  type LocationAccuracyAuthorization,
  type LocationPermissionState,
  type LocationPermissionSummary,
  type LocationTrackingError,
  type LocationTrackingState,
  updateLocationState,
} from "./location-state";

const LOCATION_DISTANCE_INTERVAL_M = 20;
const FOREGROUND_LOCATION_TIME_INTERVAL_MS = 1_000;
const BACKGROUND_LOCATION_TIME_INTERVAL_MS = 3_000;

const FOREGROUND_LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: LOCATION_DISTANCE_INTERVAL_M,
  timeInterval: FOREGROUND_LOCATION_TIME_INTERVAL_MS,
};

const BACKGROUND_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  ...FOREGROUND_LOCATION_OPTIONS,
  timeInterval: BACKGROUND_LOCATION_TIME_INTERVAL_MS,
  activityType: Location.ActivityType.OtherNavigation,
  deferredUpdatesDistance: 50,
  deferredUpdatesInterval: 60_000,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: "Yonder is tracking your location",
    notificationBody: "Visited places are being saved on this device.",
    notificationColor: "#2563EB",
    killServiceOnDestroy: false,
  },
};

let foregroundSubscription: Location.LocationSubscription | null = null;
let foregroundIngestion = Promise.resolve();
let operationQueue: Promise<void> = Promise.resolve();
let pendingOperationCount = 0;

export {
  getLocationSnapshot,
  subscribeToLocationState,
  type LocationAccuracyAuthorization,
  type LocationPermissionState,
  type LocationPermissionSummary,
  type LocationTrackingError,
  type LocationTrackingState,
};

export function refreshLocationState(): Promise<LocationTrackingState> {
  return runExclusive(async () => {
    await refreshPlatformState();
    return getLocationSnapshot();
  });
}

export function initializeLocationTracking(): Promise<LocationTrackingState> {
  return runExclusive(async () => {
    const platformState = await refreshPlatformState();

    if (!platformState.servicesEnabled) {
      stopForegroundUpdates();
      updateLocationState({
        error: {
          code: "location-services-disabled",
          message: "Turn on location services to unlock visited places.",
        },
      });
      return getLocationSnapshot();
    }

    if (platformState.permissions.foreground !== "granted") {
      stopForegroundUpdates();
      return getLocationSnapshot();
    }

    await startBestAvailableUpdates();
    return getLocationSnapshot();
  });
}

export async function requestForegroundLocationPermission(): Promise<LocationPermissionState> {
  await runExclusive(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    await refreshPlatformState(permission);

    if (!permission.granted) {
      updateLocationState({
        error: {
          code: "foreground-permission-required",
          message: "Allow location access to unlock visited places.",
        },
      });
    }

    return getLocationSnapshot();
  });

  return getLocationSnapshot().permissions.foreground;
}

export async function requestBackgroundLocationPermission(): Promise<LocationPermissionState> {
  await runExclusive(async () => {
    const foregroundPermission =
      await Location.getForegroundPermissionsAsync();

    if (!foregroundPermission.granted) {
      await refreshPlatformState(foregroundPermission);
      updateLocationState({
        error: {
          code: "foreground-permission-required",
          message: "Allow foreground location access before enabling background tracking.",
        },
      });
      return getLocationSnapshot();
    }

    const backgroundPermission =
      await Location.requestBackgroundPermissionsAsync();
    await refreshPlatformState(foregroundPermission, backgroundPermission);

    if (!backgroundPermission.granted) {
      updateLocationState({
        error: {
          code: "background-permission-required",
          message: "Background access is needed to unlock places while the app is closed.",
        },
      });
    }

    return getLocationSnapshot();
  });

  return getLocationSnapshot().permissions.background;
}

export function startLocationTracking(): Promise<LocationTrackingState> {
  return runExclusive(async () => {
    const platformState = await refreshPlatformState();

    if (!platformState.servicesEnabled) {
      updateLocationState({
        error: {
          code: "location-services-disabled",
          message: "Turn on location services to start tracking.",
        },
      });
      return getLocationSnapshot();
    }

    if (platformState.permissions.foreground !== "granted") {
      updateLocationState({
        error: {
          code: "foreground-permission-required",
          message: "Allow location access before starting tracking.",
        },
      });
      return getLocationSnapshot();
    }

    await startBestAvailableUpdates();
    return getLocationSnapshot();
  });
}

export function startBackgroundLocationTracking(): Promise<LocationTrackingState> {
  return runExclusive(async () => {
    const platformState = await refreshPlatformState();

    if (!platformState.servicesEnabled) {
      stopForegroundUpdates();
      updateLocationState({
        error: {
          code: "location-services-disabled",
          message: "Turn on location services to start background tracking.",
        },
      });
      return getLocationSnapshot();
    }

    if (platformState.permissions.foreground !== "granted") {
      updateLocationState({
        error: {
          code: "foreground-permission-required",
          message: "Allow foreground location access before enabling background tracking.",
        },
      });
      return getLocationSnapshot();
    }

    if (platformState.permissions.background !== "granted") {
      updateLocationState({
        error: {
          code: "background-permission-required",
          message: "Allow background location access before enabling background tracking.",
        },
      });
      return getLocationSnapshot();
    }

    if (!platformState.backgroundAvailable) {
      updateLocationState({
        error: {
          code: "background-tracking-unavailable",
          message: "Background tracking is unavailable in this build or on this device.",
        },
      });
      return getLocationSnapshot();
    }

    try {
      await startBackgroundUpdates();
    } catch {
      updateLocationState({
        error: {
          code: "tracking-start-failed",
          message: "Background location tracking could not be started.",
        },
      });
    }

    return getLocationSnapshot();
  });
}

export function stopLocationTracking(): Promise<LocationTrackingState> {
  return runExclusive(async () => {
    stopForegroundUpdates();

    try {
      if (await isBackgroundTrackingStarted()) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
      }
      updateLocationState({ trackingMode: "stopped", error: null });
    } catch {
      updateLocationState({
        error: {
          code: "tracking-stop-failed",
          message: "Location tracking could not be stopped.",
        },
      });
    }

    return getLocationSnapshot();
  });
}

async function startBestAvailableUpdates(): Promise<void> {
  if (await isBackgroundTrackingStarted()) {
    stopForegroundUpdates();
    await reattachAndroidForegroundService();
    updateLocationState({ trackingMode: "background", error: null });
    await seedCurrentCoordinate();
    return;
  }

  const current = getLocationSnapshot();

  if (
    current.permissions.background === "granted" &&
    current.backgroundAvailable
  ) {
    try {
      await startBackgroundUpdates();
      return;
    } catch {
      await startForegroundUpdates();
      updateLocationState({
        error: {
          code: "tracking-start-failed",
          message:
            "Background tracking could not start. Tracking will continue while the app is open.",
        },
      });
      return;
    }
  }

  await startForegroundUpdates();
}

async function startBackgroundUpdates(): Promise<void> {
  stopForegroundUpdates();

  if (!(await isBackgroundTrackingStarted())) {
    await Location.startLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK_NAME,
      BACKGROUND_LOCATION_OPTIONS,
    );
  }

  updateLocationState({ trackingMode: "background", error: null });
  await seedCurrentCoordinate();
}

// Android restores a registered location task whenever the app process
// restarts (after the OS reclaims it, an app update, or a reboot). The restore
// runs before an activity is in the foreground, so the location foreground
// service is skipped and the task is left with heavily throttled background
// updates. Re-registering the task while the app is visible starts the service
// again without replacing the existing registration.
async function reattachAndroidForegroundService(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  try {
    await Location.startLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK_NAME,
      BACKGROUND_LOCATION_OPTIONS,
    );
  } catch {
    // The existing registration keeps running. The next time the app becomes
    // active, this is attempted again.
  }
}

async function seedCurrentCoordinate(): Promise<void> {
  try {
    const location = await Location.getCurrentPositionAsync(
      FOREGROUND_LOCATION_OPTIONS,
    );
    await ingestExpoLocations([location], "live-foreground");
  } catch {
    // Background tracking remains active even if a foreground camera fix is
    // temporarily unavailable. A later background batch can still update it.
  }
}

async function startForegroundUpdates(): Promise<void> {
  if (await isBackgroundTrackingStarted()) {
    stopForegroundUpdates();
    updateLocationState({ trackingMode: "background", error: null });
    return;
  }

  if (foregroundSubscription) {
    updateLocationState({ trackingMode: "foreground", error: null });
    return;
  }

  foregroundSubscription = await Location.watchPositionAsync(
    FOREGROUND_LOCATION_OPTIONS,
    (location) => {
      const ingest = () =>
        ingestExpoLocations([location], "live-foreground");
      foregroundIngestion = foregroundIngestion.then(ingest, ingest);
    },
    () => {
      updateLocationState({
        error: {
          code: "location-update-failed",
          message: "The device could not provide a location update.",
        },
      });
    },
  );

  updateLocationState({ trackingMode: "foreground", error: null });
}

function stopForegroundUpdates(): void {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
}

async function isBackgroundTrackingStarted(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK_NAME,
    );
  } catch {
    return false;
  }
}

async function refreshPlatformState(
  knownForegroundPermission?: Location.LocationPermissionResponse,
  knownBackgroundPermission?: Location.PermissionResponse,
): Promise<LocationTrackingState> {
  const [foregroundPermission, backgroundPermission, servicesEnabled] =
    await Promise.all([
      knownForegroundPermission ?? Location.getForegroundPermissionsAsync(),
      knownBackgroundPermission ?? Location.getBackgroundPermissionsAsync(),
      Location.hasServicesEnabledAsync(),
    ]);

  let backgroundAvailable = false;

  try {
    backgroundAvailable =
      (await TaskManager.isAvailableAsync()) &&
      (await Location.isBackgroundLocationAvailableAsync());
  } catch {
    backgroundAvailable = false;
  }

  const backgroundStarted = await isBackgroundTrackingStarted();

  if (backgroundStarted) {
    stopForegroundUpdates();
  }

  updateLocationState({
    permissions: toPermissionSummary(
      foregroundPermission,
      backgroundPermission,
    ),
    servicesEnabled,
    backgroundAvailable,
    trackingMode: backgroundStarted
      ? "background"
      : foregroundSubscription
        ? "foreground"
        : "stopped",
    error: null,
  });

  return getLocationSnapshot();
}

function toPermissionSummary(
  foreground: Location.LocationPermissionResponse,
  background: Location.PermissionResponse,
): LocationPermissionSummary {
  return {
    foreground: toPermissionState(foreground.status),
    background: toPermissionState(background.status),
    accuracy: toAccuracyAuthorization(foreground),
    canAskForForeground: foreground.canAskAgain,
    canAskForBackground: background.canAskAgain,
  };
}

function toPermissionState(
  status: Location.PermissionStatus,
): LocationPermissionState {
  switch (status) {
    case Location.PermissionStatus.GRANTED:
      return "granted";
    case Location.PermissionStatus.DENIED:
      return "denied";
    default:
      return "undetermined";
  }
}

function toAccuracyAuthorization(
  permission: Location.LocationPermissionResponse,
): LocationAccuracyAuthorization {
  if (permission.ios) {
    return permission.ios.accuracy === "full" ? "precise" : "reduced";
  }

  if (permission.android) {
    if (permission.android.accuracy === "fine") {
      return "precise";
    }

    if (permission.android.accuracy === "coarse") {
      return "reduced";
    }
  }

  return "unknown";
}

function runExclusive(
  operation: () => Promise<LocationTrackingState>,
): Promise<LocationTrackingState> {
  pendingOperationCount += 1;
  updateLocationState({ busy: true, error: null });

  const execution = operationQueue.then(operation, operation);
  operationQueue = execution.then(
    () => undefined,
    () => undefined,
  );

  return execution
    .catch(() => {
      updateLocationState({
        error: {
          code: "unexpected",
          message: "Location settings could not be updated.",
        },
      });
      return getLocationSnapshot();
    })
    .finally(() => {
      pendingOperationCount -= 1;
      if (pendingOperationCount === 0) {
        updateLocationState({ busy: false });
      }
    })
    .then(getLocationSnapshot);
}
