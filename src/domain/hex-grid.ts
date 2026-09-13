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
  const polygons = cellsToMultiPolygon([...cellIds], true);
  const exteriors = polygons.flatMap((polygon) =>
    polygon[0] ? [polygon[0] as Position[]] : [],
  );
  const holes = polygons.flatMap((polygon) => polygon.slice(1) as Position[][]);
  // A hole in the visited union is an unvisited island. Give each visited
  // exterior to its innermost enclosing island (or to the world veil).
  const regions = [worldRing, ...holes];
  const cutouts: Position[][][] = regions.map(() => []);
  for (const exterior of exteriors) {
    const point = exterior[0];
    if (!point) continue;
    let owner = 0;
    for (let index = 1; index < regions.length; index += 1) {
      const candidate = regions[index]!;
      if (
        ringContainsPoint(candidate, point) &&
        (owner === 0 || ringContainsPoint(regions[owner]!, candidate[0]!))
      ) {
        owner = index;
      }
    }
    cutouts[owner]!.push([...exterior].reverse());
  }

  return {
    type: "FeatureCollection",
    features: regions.map((ring, index) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [index === 0 ? ring : [...ring].reverse(), ...cutouts[index]!],
      },
    })),
  };
}

function ringContainsPoint(ring: Position[], point: Position): boolean {
  const [x, y] = point as [number, number];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
