import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import {
  cellToBoundary,
  cellToLatLng,
  getResolution,
  latLngToCell,
} from "h3-js";

import type { GeographicCoordinate, UnlockedCell } from "./tessera";
import { assertValidResolution } from "./tessera";

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
  fillColor: string;
  fillOpacity: number;
  resolution: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
};

const TESSERA_COLORS = [
  "#176F68",
  "#238477",
  "#319584",
  "#5A9B83",
  "#B78045",
  "#C69958",
] as const;

function hashCellId(cellId: string): number {
  let hash = 2166136261;

  for (let index = 0; index < cellId.length; index += 1) {
    hash ^= cellId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededUnitValue(seed: number): number {
  let value = seed;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function decorativeTesseraRing(
  boundary: readonly GeographicCoordinate[],
  cellId: string,
): Position[] {
  if (boundary.length === 0) {
    return [];
  }

  const centroid = boundary.reduce(
    (sum, coordinate) => ({
      latitude: sum.latitude + coordinate.latitude / boundary.length,
      longitude: sum.longitude + coordinate.longitude / boundary.length,
    }),
    { latitude: 0, longitude: 0 },
  );
  const seed = hashCellId(cellId);
  const baseScale = 0.78 + seededUnitValue(seed) * 0.11;
  const positions = boundary.map<Position>((coordinate, index) => {
    const vertexVariation =
      (seededUnitValue(seed + Math.imul(index + 1, 0x9e3779b1)) - 0.5) *
      0.09;
    const scale = Math.min(0.92, Math.max(0.72, baseScale + vertexVariation));

    return [
      centroid.longitude + (coordinate.longitude - centroid.longitude) * scale,
      centroid.latitude + (coordinate.latitude - centroid.latitude) * scale,
    ];
  });

  positions.push([...positions[0]!]);
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

      const visualSeed = hashCellId(cell.cellId);

      return {
        type: "Feature",
        id: `${cell.resolution}:${cell.cellId}`,
        properties: {
          cellId: cell.cellId,
          fillColor: TESSERA_COLORS[visualSeed % TESSERA_COLORS.length]!,
          fillOpacity: 0.72 + seededUnitValue(visualSeed ^ 0xa5a5a5a5) * 0.12,
          resolution: cell.resolution,
          firstSeenAtMs: cell.firstSeenAtMs,
          lastSeenAtMs: cell.lastSeenAtMs,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            decorativeTesseraRing(
              hexGrid.boundaryForCell(cell.cellId),
              cell.cellId,
            ),
          ],
        },
      };
    },
  );

  return { type: "FeatureCollection", features };
}
