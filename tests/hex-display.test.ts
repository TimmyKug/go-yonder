import { cellToChildren, cellToParent, getResolution, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";

import { cellIdsAtDisplayResolution, displayResolutionForZoom } from "../src/domain/hex-display";

const cell = latLngToCell(10, 20, 11);

describe("zoom-dependent hex display", () => {
  it.each([[20, 11], [15, 11], [14, 10], [13, 10], [12, 9], [11, 9], [9, 8], [7, 7], [5, 6], [3, 5], [2, 4]])(
    "maps zoom %i to resolution %i", (zoom, resolution) => {
      expect(displayResolutionForZoom(zoom)).toBe(resolution);
    },
  );

  it("does not flicker around a scale boundary", () => {
    expect(displayResolutionForZoom(14.9, 11)).toBe(11);
    expect(displayResolutionForZoom(14.8, 11)).toBe(10);
    expect(displayResolutionForZoom(15.1, 10)).toBe(10);
    expect(displayResolutionForZoom(15.2, 10)).toBe(11);
  });

  it("handles large zoom jumps and invalid camera events", () => {
    expect(displayResolutionForZoom(4, 11)).toBe(5);
    expect(displayResolutionForZoom(18, 4)).toBe(11);
    expect(displayResolutionForZoom(Number.NaN, 9)).toBe(9);
  });

  it("merges siblings into one coarse hex without changing the input", () => {
    const parent = cellToParent(cell, 10);
    const children = Object.freeze(cellToChildren(parent, 11));
    expect(cellIdsAtDisplayResolution(children, 10)).toEqual([parent]);
    expect(cellIdsAtDisplayResolution(children, 11)).toEqual(children);
    expect(children.every((id) => getResolution(id) === 11)).toBe(true);
  });

  it("restores exact sparse coverage after zooming back in", () => {
    const siblings = cellToChildren(cellToParent(cell, 10), 11);
    const visited = [siblings[0]!, siblings[3]!];
    expect(cellIdsAtDisplayResolution(visited, 8)).toHaveLength(1);
    expect(cellIdsAtDisplayResolution(visited, 11)).toEqual(visited);
  });

  it("supports all display levels, deduplicates inputs, and handles empty coverage", () => {
    for (let resolution = 4; resolution <= 11; resolution++) {
      expect(cellIdsAtDisplayResolution([cell, cell], resolution)).toEqual([cellToParent(cell, resolution)]);
      expect(cellIdsAtDisplayResolution([], resolution)).toEqual([]);
    }
  });

  it("rejects mixed source resolutions and invalid display resolutions", () => {
    expect(() => cellIdsAtDisplayResolution([cellToParent(cell, 10)], 9)).toThrow(/canonical/);
    for (const resolution of [3, 12, 4.5, Number.NaN]) {
      expect(() => cellIdsAtDisplayResolution([cell], resolution)).toThrow(RangeError);
    }
  });
});
