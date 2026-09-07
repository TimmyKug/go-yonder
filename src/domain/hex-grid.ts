import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import {
  cellToBoundary,
  cellToLatLng,
  cellsToMultiPolygon,
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

function coordinateKey(coordinate: GeographicCoordinate): string {
  return `${coordinate.latitude.toFixed(12)},${coordinate.longitude.toFixed(12)}`;
}

function edgeKey(
  start: GeographicCoordinate,
  end: GeographicCoordinate,
): string {
  const startKey = coordinateKey(start);
  const endKey = coordinateKey(end);
  return startKey < endKey
    ? `${startKey}|${endKey}`
    : `${endKey}|${startKey}`;
}

function decorativeTesseraRing(
  boundary: readonly GeographicCoordinate[],
  sharedEdges: ReadonlySet<string>,
): Position[] {
  if (boundary.length === 0) {
    return [];
  }

  const positions: Position[] = [];
  boundary.forEach((start, index) => {
    const end = boundary[(index + 1) % boundary.length]!;
    const key = edgeKey(start, end);
    positions.push([start.longitude, start.latitude]);

    const midpointLongitude = (start.longitude + end.longitude) / 2;
    const midpointLatitude = (start.latitude + end.latitude) / 2;
    if (!sharedEdges.has(key)) {
      positions.push([midpointLongitude, midpointLatitude]);
      return;
    }

    const [canonicalStart, canonicalEnd] =
      coordinateKey(start) < coordinateKey(end) ? [start, end] : [end, start];
    const latitudeDelta = canonicalEnd.latitude - canonicalStart.latitude;
    const longitudeDelta = canonicalEnd.longitude - canonicalStart.longitude;
    const seed = hashCellId(key);
    const bend =
      (seededUnitValue(seed) < 0.5 ? -1 : 1) *
      (0.12 + seededUnitValue(seed ^ 0x85ebca6b) * 0.16);

    positions.push([
      midpointLongitude - latitudeDelta * bend,
      midpointLatitude + longitudeDelta * bend,
    ]);
  });

  positions.push([...positions[0]!]);
  return positions;
}

export function unlockedCellsToFeatureCollection(
  cells: readonly UnlockedCell[],
  hexGrid: HexGrid = h3HexGrid,
): FeatureCollection<Polygon, UnlockedCellFeatureProperties> {
  const boundaries = new Map(
    cells.map((cell) => [cell.cellId, hexGrid.boundaryForCell(cell.cellId)]),
  );
  const edgeCounts = new Map<string, number>();
  boundaries.forEach((boundary) => {
    boundary.forEach((start, index) => {
      const end = boundary[(index + 1) % boundary.length]!;
      const key = edgeKey(start, end);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    });
  });
  const sharedEdges = new Set(
    [...edgeCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
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
          fillOpacity: 0.18 + seededUnitValue(visualSeed ^ 0xa5a5a5a5) * 0.06,
          resolution: cell.resolution,
          firstSeenAtMs: cell.firstSeenAtMs,
          lastSeenAtMs: cell.lastSeenAtMs,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            decorativeTesseraRing(
              boundaries.get(cell.cellId) ?? [],
              sharedEdges,
            ),
          ],
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
