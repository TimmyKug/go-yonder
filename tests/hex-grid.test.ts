import { describe, expect, it } from "vitest";
import { gridDisk } from "h3-js";

import {
  H3HexGrid,
  unlockedCellIdsToVeilMask,
  unlockedCellsToFeatureCollection,
} from "../src/domain/hex-grid";

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

  it("emits the closed canonical boundary for an unlocked H3 cell", () => {
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
    expect(ring?.slice(0, -1)).toEqual(h3Boundary);
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

  it("cuts connected unlocked cells out of one world veil", () => {
    const origin = grid.cellForCoordinate({ latitude: 10, longitude: 20 }, 11);
    const connectedCells = gridDisk(origin, 1);
    const veil = unlockedCellIdsToVeilMask(connectedCells);
    const rings = veil.features[0]?.geometry.coordinates;

    expect(rings).toHaveLength(2);
    expect(rings?.[0]).toEqual([
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ]);
    expect(rings?.[1]?.at(-1)).toEqual(rings?.[1]?.[0]);
  });

  it("keeps the full veil when no cells are unlocked", () => {
    const veil = unlockedCellIdsToVeilMask([]);

    expect(veil.features[0]?.geometry.coordinates).toHaveLength(1);
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
