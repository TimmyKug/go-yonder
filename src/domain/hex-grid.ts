import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import {
  cellToBoundary,
  cellToLatLng,
  cellsToMultiPolygon,
  getResolution,
  latLngToCell,
} from "h3-js";

import type { GeographicCoordinate, UnlockedCell } from "./yonder";
import { assertValidResolution } from "./yonder";

export interface HexGrid {
  cellForCoordinate(
    coordinate: GeographicCoordinate,
    resolution: number,
  ): string;
  resolutionForCell(cellId: string): number;
  centerForCell(cellId: string): GeographicCoordinate;
  boundaryForCell(cellId: string): readonly GeographicCoordinate[];
}

export class H3HexGrid implements HexGrid {
  cellForCoordinate(
    coordinate: GeographicCoordinate,
    resolution: number,
  ): string {
    assertValidResolution(resolution);
    return latLngToCell(coordinate.latitude, coordinate.longitude, resolution);
  }

  resolutionForCell(cellId: string): number {
    return getResolution(cellId);
  }

  centerForCell(cellId: string): GeographicCoordinate {
    const [latitude, longitude] = cellToLatLng(cellId);
    return { latitude, longitude };
  }

  boundaryForCell(cellId: string): readonly GeographicCoordinate[] {
    return cellToBoundary(cellId).map(([latitude, longitude]) => ({
      latitude,
      longitude,
    }));
  }
}

export const h3HexGrid: HexGrid = new H3HexGrid();

export type UnlockedCellFeatureProperties = {
  cellId: string;
  resolution: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
};

export function unlockedCellsToFeatureCollection(
  cells: readonly UnlockedCell[],
  hexGrid: HexGrid = h3HexGrid,
): FeatureCollection<Polygon, UnlockedCellFeatureProperties> {
  const features: Feature<Polygon, UnlockedCellFeatureProperties>[] = cells.map(
    (cell) => {
      const actualResolution = hexGrid.resolutionForCell(cell.cellId);
      if (actualResolution !== cell.resolution) {
        throw new Error(
          "persisted cell resolution does not match its cell identifier",
        );
      }

      const ring = hexGrid
        .boundaryForCell(cell.cellId)
        .map<Position>(({ latitude, longitude }) => [longitude, latitude]);

      if (ring[0]) {
        ring.push([...ring[0]]);
      }

      return {
        type: "Feature",
        id: `${cell.resolution}:${cell.cellId}`,
        properties: {
          cellId: cell.cellId,
          resolution: cell.resolution,
          firstSeenAtMs: cell.firstSeenAtMs,
          lastSeenAtMs: cell.lastSeenAtMs,
        },
        geometry: {
          type: "Polygon",
          coordinates: [ring],
        },
      };
    },
  );

  return { type: "FeatureCollection", features };
}

export function unlockedCellIdsToVeilMask(
  cellIds: readonly string[],
): FeatureCollection<Polygon> {
  const worldRing: Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const unlockedRegionRings = cellsToMultiPolygon([...cellIds], true).flatMap(
    (polygon) => {
      const exteriorRing = polygon[0];

      return exteriorRing ? [[...exteriorRing].reverse() as Position[]] : [];
    },
  );

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [worldRing, ...unlockedRegionRings],
        },
      },
    ],
  };
}
