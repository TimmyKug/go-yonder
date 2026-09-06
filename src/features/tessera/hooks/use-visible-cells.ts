import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { TESSERA_H3_RESOLUTION } from "@/src/config/tessera-config";
import { getTesseraRepository } from "@/src/data/app-repository";
import { lockedCellsToFeatureCollection } from "@/src/domain/hex-grid";

const EMPTY_TESSERAE: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
  type: "FeatureCollection",
  features: [],
};

type MapBounds = [west: number, south: number, east: number, north: number];

type VisibleCellsState = {
  error?: string;
  tesserae: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  isLoading: boolean;
  setBounds: (bounds: MapBounds) => void;
};

export function useVisibleCells(refreshToken?: number): VisibleCellsState {
  const [bounds, setBounds] = useState<MapBounds>([13.1, 52.35, 13.7, 52.7]);
  const [tesserae, setTesserae] =
    useState<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(EMPTY_TESSERAE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [activationRevision, setActivationRevision] = useState(0);
  const requestRevision = useRef(0);

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

      try {
        const repository = await getTesseraRepository();
        const [west, south, east, north] = bounds;
        const cells = await repository.listUnlockedCells({
          east,
          north,
          south,
          west,
        });
        const collection = lockedCellsToFeatureCollection(
          bounds,
          new Set(cells.map((cell) => cell.cellId)),
          TESSERA_H3_RESOLUTION,
        );

        if (!cancelled && requestRevision.current === revision) {
          setTesserae(
            collection as GeoJSON.FeatureCollection<GeoJSON.Polygon>,
          );
          setError(undefined);
        }
      } catch {
        if (!cancelled && requestRevision.current === revision) {
          setError("Your saved map could not be read from this device.");
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
    setBounds((currentBounds) =>
      currentBounds.every((value, index) => value === nextBounds[index])
        ? currentBounds
        : nextBounds,
    );
  }, []);

  return {
    error,
    tesserae,
    isLoading,
    setBounds: updateBounds,
  };
}
