import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";

import { useVisibleCells } from "../hooks/use-visible-cells";

import {
  ScratchMapView,
  type TrackingPresentation,
} from "./scratch-map-view";

import {
  getLocationSnapshot,
  initializeLocationTracking,
  requestBackgroundLocationPermission,
  requestForegroundLocationPermission,
  startLocationTracking,
  subscribeToLocationState,
} from "@/src/location";

export function ScratchMapScreen() {
  const location = useSyncExternalStore(
    subscribeToLocationState,
    getLocationSnapshot,
    getLocationSnapshot,
  );
  const visibleCells = useVisibleCells(
    location.latestCoordinate?.timestampMs,
  );

  useEffect(() => {
    void initializeLocationTracking();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void initializeLocationTracking();
      }
    });

    return () => subscription.remove();
  }, []);

  const tracking = useMemo<TrackingPresentation>(() => {
    if (visibleCells.error) {
      return {
        detail: visibleCells.error,
        isBusy: false,
        kind: "unavailable",
        title: "Saved map unavailable",
      };
    }

    if (location.servicesEnabled === false) {
      return {
        actionLabel: "Open settings",
        detail: "Turn on Location Services in system settings to unlock places.",
        isBusy: false,
        kind: "unavailable",
        title: "Location Services are off",
      };
    }

    if (location.permissions.foreground !== "granted") {
      return {
        actionLabel: location.permissions.canAskForForeground
          ? "Allow location"
          : "Open settings",
        detail: location.permissions.canAskForForeground
          ? "Your coordinates stay on this device and unlock the hexes you visit."
          : "Enable precise location for Scratch Map in system settings.",
        isBusy: location.busy,
        kind: "needs-action",
        title: "Start your scratch map",
      };
    }

    if (location.permissions.accuracy === "reduced") {
      return {
        actionLabel: "Open settings",
        detail:
          "Precise location is required so nearby hexes are not unlocked by mistake.",
        isBusy: false,
        kind: "needs-action",
        title: "Enable precise location",
      };
    }

    if (
      location.error &&
      location.error.code !== "foreground-permission-required" &&
      location.error.code !== "background-permission-required"
    ) {
      return {
        actionLabel:
          location.error.code === "tracking-start-failed"
            ? "Try again"
            : undefined,
        detail: location.error.message,
        isBusy: location.busy,
        kind: "unavailable",
        title: "Tracking needs attention",
      };
    }

    if (
      location.permissions.background !== "granted" &&
      location.backgroundAvailable !== false
    ) {
      return {
        actionLabel: location.permissions.canAskForBackground
          ? "Allow always"
          : "Open settings",
        detail: location.permissions.canAskForBackground
          ? "Allow background access to keep unlocking with your phone in your pocket."
          : "Foreground tracking is active. Background access can be enabled in system settings.",
        isBusy: location.busy,
        kind: "needs-action",
        title: "Tracking while open",
      };
    }

    if (location.error) {
      return {
        detail: location.error.message,
        isBusy: location.busy,
        kind: "unavailable",
        title: "Tracking needs attention",
      };
    }

    if (location.trackingMode === "background") {
      return {
        detail: "Hexes unlock while the app is open or in the background.",
        isBusy: location.busy,
        kind: "active",
        title: "Background tracking is on",
      };
    }

    return {
      actionLabel:
        location.trackingMode === "stopped" ? "Start tracking" : undefined,
      detail:
        location.trackingMode === "foreground"
          ? "Keep the app open to unlock the hexes you visit."
          : "Location is allowed, but tracking is currently stopped.",
      isBusy: location.busy,
      kind: location.trackingMode === "foreground" ? "active" : "needs-action",
      title:
        location.trackingMode === "foreground"
          ? "Tracking while open"
          : "Tracking is paused",
    };
  }, [location, visibleCells.error]);

  const handleTrackingAction = useCallback(async () => {
    if (
      location.servicesEnabled === false ||
      location.permissions.accuracy === "reduced"
    ) {
      await Linking.openSettings();
      return;
    }

    if (location.permissions.foreground !== "granted") {
      if (!location.permissions.canAskForForeground) {
        await Linking.openSettings();
        return;
      }

      const permission = await requestForegroundLocationPermission();
      if (permission === "granted") {
        await startLocationTracking();
      }
      return;
    }

    if (
      location.permissions.background !== "granted" &&
      location.backgroundAvailable !== false
    ) {
      if (!location.permissions.canAskForBackground) {
        await Linking.openSettings();
        return;
      }

      const permission = await requestBackgroundLocationPermission();
      if (permission === "granted") {
        await startLocationTracking();
      }
      return;
    }

    await startLocationTracking();
  }, [
    location.backgroundAvailable,
    location.permissions.background,
    location.permissions.canAskForBackground,
    location.permissions.canAskForForeground,
    location.permissions.accuracy,
    location.permissions.foreground,
    location.servicesEnabled,
  ]);

  return (
    <ScratchMapView
      currentCoordinate={location.latestCoordinate}
      hexagons={visibleCells.hexagons}
      isLoadingHexagons={visibleCells.isLoading}
      onBoundsChange={visibleCells.setBounds}
      onTrackingAction={handleTrackingAction}
      tracking={tracking}
    />
  );
}
