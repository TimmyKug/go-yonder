import { describe, expect, it } from "vitest";

import {
  H3HexGrid,
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

  it("emits GeoJSON in longitude/latitude order and closes the polygon", () => {
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

    const domainBoundary = grid.boundaryForCell(cellId)[0];
    expect(ring?.[0]).toEqual([
      domainBoundary?.longitude,
      domainBoundary?.latitude,
    ]);
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
