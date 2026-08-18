import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import {
  cellToBoundary,
  cellToLatLng,
  getResolution,
  latLngToCell,
} from "h3-js";

import type { GeographicCoordinate, UnlockedCell } from "./scratch-map";
import { assertValidResolution } from "./scratch-map";

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

function closedGeoJsonRing(
  boundary: readonly GeographicCoordinate[],
): Position[] {
  const positions = boundary.map<Position>(({ latitude, longitude }) => [
    longitude,
    latitude,
  ]);

  const first = positions[0];
  const last = positions.at(-1);
  if (
    first !== undefined &&
    last !== undefined &&
    (first[0] !== last[0] || first[1] !== last[1])
  ) {
    positions.push([...first]);
  }

  return positions;
}

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
          coordinates: [closedGeoJsonRing(hexGrid.boundaryForCell(cell.cellId))],
        },
      };
    },
  );

  return { type: "FeatureCollection", features };
}
