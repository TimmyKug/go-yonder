import { describe, expect, it } from "vitest";
import { cellToLatLng, gridDisk, gridRing } from "h3-js";

import {
  H3HexGrid,
  unlockedCellIdsToVeilMask,
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

});

function veilCoversCell(veil: ReturnType<typeof unlockedCellIdsToVeilMask>, cell: string) {
  const [y, x] = cellToLatLng(cell);
  const contains = (ring: GeoJSON.Position[]) => {
    let crossings = 0;
    for (let i = 1; i < ring.length; i += 1) {
      const [ax, ay] = ring[i - 1] as [number, number];
      const [bx, by] = ring[i] as [number, number];
      if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) crossings++;
    }
    return crossings % 2 === 1;
  };
  return veil.features.some(({ geometry: { coordinates } }) =>
    contains(coordinates[0]!) && !coordinates.slice(1).some(contains),
  );
}

describe("enclosed unvisited cells", () => {
  const center = new H3HexGrid().cellForCoordinate({ latitude: 10, longitude: 20 }, 11);

  it.each([5, 6])("keeps the center covered with %i visited neighbors", (count) => {
    const visited = gridRing(center, 1).slice(0, count);
    const veil = unlockedCellIdsToVeilMask(visited);
    expect(veilCoversCell(veil, center)).toBe(true);
    for (const cell of visited) expect(veilCoversCell(veil, cell)).toBe(false);
  });

  it("preserves nested unvisited regions and visited islands", () => {
    const visited = [...gridRing(center, 4), ...gridRing(center, 2)];
    const veil = unlockedCellIdsToVeilMask(visited);
    for (const cell of gridDisk(center, 5)) {
      expect(veilCoversCell(veil, cell)).toBe(!visited.includes(cell));
    }
  });
});
