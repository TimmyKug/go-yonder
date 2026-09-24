import type * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { ingestExpoLocations } from "./location-ingestion";
import { updateLocationState } from "./location-state";

import { flushDiagnostics, recordDiagnostic } from "@/src/diagnostics/diagnostics";
import { describeError } from "@/src/domain/diagnostic-event";

export const BACKGROUND_LOCATION_TASK_NAME =
  "yonder-background-location";

type BackgroundLocationTaskData = {
  locations?: Location.LocationObject[];
};

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK_NAME)) {
  TaskManager.defineTask<BackgroundLocationTaskData>(
    BACKGROUND_LOCATION_TASK_NAME,
    async ({ data, error }) => {
      if (error) {
        recordDiagnostic("background-task-error", {
          error: describeError(error),
        });
        updateLocationState({
          error: {
            code: "location-update-failed",
            message: "Background location tracking encountered an error.",
          },
        });
        await flushDiagnostics();
        return;
      }

      if (!Array.isArray(data?.locations) || data.locations.length === 0) {
        recordDiagnostic("background-batch", { receivedCount: 0 });
        await flushDiagnostics();
        return;
      }

      const summary = await ingestExpoLocations(
        data.locations,
        "live-background",
      );
      recordDiagnostic("background-batch", {
        ...summary,
        ...describeBatch(data.locations, Date.now()),
      });
      await flushDiagnostics();
    },
  );
}

/** Timing and accuracy of a batch, without any position. */
export function describeBatch(
  locations: readonly Location.LocationObject[],
  nowMs: number,
): Record<string, number | null> {
  const timestamps = locations
    .map((location) => location.timestamp)
    .filter(Number.isFinite);
  const accuracies = locations
    .map((location) => location.coords.accuracy)
    .filter((accuracy): accuracy is number => Number.isFinite(accuracy));

  return {
    oldestAgeS:
      timestamps.length > 0
        ? Math.round((nowMs - Math.min(...timestamps)) / 1000)
        : null,
    newestAgeS:
      timestamps.length > 0
        ? Math.round((nowMs - Math.max(...timestamps)) / 1000)
        : null,
    bestAccuracyM:
      accuracies.length > 0 ? Math.round(Math.min(...accuracies)) : null,
    worstAccuracyM:
      accuracies.length > 0 ? Math.round(Math.max(...accuracies)) : null,
  };
}
