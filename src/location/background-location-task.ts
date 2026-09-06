import type * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { ingestExpoLocations } from "./location-ingestion";
import { updateLocationState } from "./location-state";

export const BACKGROUND_LOCATION_TASK_NAME =
  "tessera-background-location";

type BackgroundLocationTaskData = {
  locations?: Location.LocationObject[];
};

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK_NAME)) {
  TaskManager.defineTask<BackgroundLocationTaskData>(
    BACKGROUND_LOCATION_TASK_NAME,
    async ({ data, error }) => {
      if (error) {
        updateLocationState({
          error: {
            code: "location-update-failed",
            message: "Background location tracking encountered an error.",
          },
        });
        return;
      }

      if (!Array.isArray(data?.locations) || data.locations.length === 0) {
        return;
      }

      await ingestExpoLocations(data.locations, "live-background");
    },
  );
}
