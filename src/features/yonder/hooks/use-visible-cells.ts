import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { getYonderRepository } from "@/src/data/app-repository";
import { describeBackupCause } from "@/src/data/backup-failure";
import { recordDiagnostic } from "@/src/diagnostics/diagnostics";
import { type MapBounds, nextCoverageBounds, padMapBounds } from "@/src/domain/map-bounds";

const NO_CELLS: readonly string[] = [];

type VisibleCellsState = {
  /** Resolution-11 cell IDs unlocked within the loaded bounds. */
  cellIds: readonly string[];
  error?: string;
  isLoading: boolean;
  setBounds: (bounds: MapBounds) => void;
};

export function useVisibleCells(refreshToken?: number): VisibleCellsState {
  const [bounds, setBounds] = useState<MapBounds>(() =>
    padMapBounds([13.1, 52.35, 13.7, 52.7]),
  );
  const [cellIds, setCellIds] = useState<readonly string[]>(NO_CELLS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [activationRevision, setActivationRevision] = useState(0);
  const requestRevision = useRef(0);

  useFocusEffect(useCallback(() => {
    setActivationRevision((revision) => revision + 1);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setActivationRevision((revision) => revision + 1);
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const revision = requestRevision.current + 1;
    requestRevision.current = revision;
    let cancelled = false;

    async function loadVisibleCells() {
      setIsLoading(true);
      let step = "open database";
      let cellCount: number | null = null;

      try {
        const repository = await getYonderRepository();
        const [west, south, east, north] = bounds;
        step = "read tiles";
        const cells = await repository.listUnlockedCells({
          east,
          north,
          south,
          west,
        });
        cellCount = cells.length;

        if (!cancelled && requestRevision.current === revision) {
          setCellIds(cells.map(({ cellId }) => cellId));
          setError(undefined);
        }
      } catch (error: unknown) {
        // The reason is scrubbed of URIs, paths, and decimal numbers.
        const reason = describeBackupCause(error);
        recordDiagnostic("map-load-error", { step, reason, cellCount });
        if (!cancelled && requestRevision.current === revision) {
          setError(`Your saved map could not be read from this device. (${step}: ${reason})`);
        }
      } finally {
        if (!cancelled && requestRevision.current === revision) {
          setIsLoading(false);
        }
      }
    }

    void loadVisibleCells();

    return () => {
      cancelled = true;
    };
  }, [activationRevision, bounds, refreshToken]);

  const updateBounds = useCallback((nextBounds: MapBounds) => {
    setBounds((currentBounds) => nextCoverageBounds(currentBounds, nextBounds));
  }, []);

  return {
    cellIds,
    error,
    isLoading,
    setBounds: updateBounds,
  };
}
