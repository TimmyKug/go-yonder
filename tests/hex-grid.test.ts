import { describe, expect, it } from "vitest";

import {
  H3HexGrid,
  unlockedCellsToFeatureCollection,
} from "../src/domain/hex-grid";

function pointInsideConvexPolygon(
  point: GeoJSON.Position,
  polygon: readonly GeoJSON.Position[],
): boolean {
  let direction = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    const cross =
      (end[0]! - start[0]!) * (point[1]! - start[1]!) -
      (end[1]! - start[1]!) * (point[0]! - start[0]!);

    if (Math.abs(cross) < 1e-12) {
      continue;
    }

    const nextDirection = Math.sign(cross);
    if (direction !== 0 && nextDirection !== direction) {
      return false;
    }
    direction = nextDirection;
  }

  return true;
}

describe("H3HexGrid", () => {
  const grid = new H3HexGrid();

  it("maps a known coordinate fixture to a stable resolution-11 cell", () => {
    const cellId = grid.cellForCoordinate(
      { latitude: 37.775938728915946, longitude: -122.41795063018799 },
      11,
    );

    expect(cellId).toBe("8b28308280f1fff");
    expect(grid.resolutionForCell(cellId)).toBe(11);
  });

  it("emits a closed decorative tessera contained by its H3 cell", () => {
    const cellId = grid.cellForCoordinate({ latitude: 10, longitude: 20 }, 11);
    const center = grid.centerForCell(cellId);
    const collection = unlockedCellsToFeatureCollection([
      {
        cellId,
        resolution: 11,
        centerLatitude: center.latitude,
        centerLongitude: center.longitude,
        firstSeenAtMs: 100,
        lastSeenAtMs: 200,
      },
    ]);

    const feature = collection.features[0];
    expect(feature).toBeDefined();
    expect(feature?.geometry.type).toBe("Polygon");
    const ring = feature?.geometry.coordinates[0];
    expect(ring).toHaveLength(7);
    expect(ring?.at(-1)).toEqual(ring?.[0]);

    const h3Boundary = grid.boundaryForCell(cellId).map<GeoJSON.Position>(
      ({ latitude, longitude }) => [longitude, latitude],
    );
    expect(
      ring?.slice(0, -1).every((point) =>
        pointInsideConvexPolygon(point, h3Boundary),
      ),
    ).toBe(true);
    expect(feature?.properties.fillColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(feature?.properties.fillOpacity).toBeGreaterThanOrEqual(0.72);
    expect(feature?.properties.fillOpacity).toBeLessThanOrEqual(0.84);
  });

  it("derives identical visual geometry and styling for the same cell", () => {
    const cellId = grid.cellForCoordinate({ latitude: 10, longitude: 20 }, 11);
    const cell = {
      cellId,
      resolution: 11,
      centerLatitude: 10,
      centerLongitude: 20,
      firstSeenAtMs: 100,
      lastSeenAtMs: 200,
    };

    expect(unlockedCellsToFeatureCollection([cell])).toEqual(
      unlockedCellsToFeatureCollection([cell]),
    );
  });

  it("refuses persisted resolution metadata that disagrees with H3", () => {
    const cellId = grid.cellForCoordinate({ latitude: 10, longitude: 20 }, 11);
    expect(() =>
      unlockedCellsToFeatureCollection([
        {
          cellId,
          resolution: 10,
          centerLatitude: 10,
          centerLongitude: 20,
          firstSeenAtMs: 100,
          lastSeenAtMs: 100,
        },
      ]),
    ).toThrow(/resolution/);
  });
});
