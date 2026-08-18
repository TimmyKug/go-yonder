export type LocationPermissionState = "denied" | "granted" | "undetermined";

export type LocationAccuracyAuthorization =
  | "precise"
  | "reduced"
  | "unknown";

export type LocationTrackingMode = "background" | "foreground" | "stopped";

export type LocationTrackingErrorCode =
  | "background-permission-required"
  | "background-tracking-unavailable"
  | "foreground-permission-required"
  | "ingestion-failed"
  | "location-services-disabled"
  | "location-update-failed"
  | "tracking-start-failed"
  | "tracking-stop-failed"
  | "unexpected";

export type LocationTrackingError = Readonly<{
  code: LocationTrackingErrorCode;
  message: string;
}>;

export type LocationPermissionSummary = Readonly<{
  foreground: LocationPermissionState;
  background: LocationPermissionState;
  accuracy: LocationAccuracyAuthorization;
  canAskForForeground: boolean;
  canAskForBackground: boolean;
}>;

export type LatestCoordinate = Readonly<{
  latitude: number;
  longitude: number;
  accuracyM?: number;
  timestampMs: number;
}>;

export type LocationTrackingState = Readonly<{
  permissions: LocationPermissionSummary;
  trackingMode: LocationTrackingMode;
  servicesEnabled: boolean | null;
  backgroundAvailable: boolean | null;
  latestCoordinate?: LatestCoordinate;
  busy: boolean;
  error: LocationTrackingError | null;
}>;

type LocationStateListener = () => void;

const listeners = new Set<LocationStateListener>();

let snapshot: LocationTrackingState = freezeState({
  permissions: {
    foreground: "undetermined",
    background: "undetermined",
    accuracy: "unknown",
    canAskForForeground: true,
    canAskForBackground: true,
  },
  trackingMode: "stopped",
  servicesEnabled: null,
  backgroundAvailable: null,
  busy: false,
  error: null,
});

export function getLocationSnapshot(): LocationTrackingState {
  return snapshot;
}

export function subscribeToLocationState(
  listener: LocationStateListener,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function updateLocationState(
  update:
    | Partial<LocationTrackingState>
    | ((current: LocationTrackingState) => Partial<LocationTrackingState>),
): void {
  const nextValues = typeof update === "function" ? update(snapshot) : update;

  snapshot = freezeState({
    ...snapshot,
    ...nextValues,
  });

  for (const listener of listeners) {
    listener();
  }
}

export function updateLatestCoordinate(coordinate: LatestCoordinate): void {
  updateLocationState((current) => {
    if (
      current.latestCoordinate &&
      current.latestCoordinate.timestampMs > coordinate.timestampMs
    ) {
      return {};
    }

    return { latestCoordinate: coordinate };
  });
}

function freezeState(state: LocationTrackingState): LocationTrackingState {
  return Object.freeze({
    ...state,
    permissions: Object.freeze({ ...state.permissions }),
    latestCoordinate: state.latestCoordinate
      ? Object.freeze({ ...state.latestCoordinate })
      : undefined,
    error: state.error ? Object.freeze({ ...state.error }) : null,
  });
}
