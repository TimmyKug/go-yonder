import { cellToChildren, cellToParent, getResolution, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";

import { cellIdsAtDisplayResolution, displayResolutionForZoom, isValidMapZoom } from "../src/domain/hex-display";

const cell = latLngToCell(10, 20, 11);

describe("zoom-dependent hex display", () => {
  it("ignores startup zooms and invalid camera events", () => {
    for (const zoom of [0, -1, Number.NaN, Infinity, -Infinity, 21]) {
      expect(isValidMapZoom(zoom)).toBe(false);
    }
    for (const zoom of [2, 4.5, 15, 20]) expect(isValidMapZoom(zoom)).toBe(true);
  });
  it.each([[20, 10], [14, 10], [12, 10], [11, 9], [10, 9], [9, 8], [7, 7], [5, 6], [4, 6], [3, 5], [2, 5]])(
    "maps zoom %i to resolution %i", (zoom, resolution) => {
      expect(displayResolutionForZoom(zoom)).toBe(resolution);
    },
  );

  it("does not flicker around a scale boundary", () => {
    expect(displayResolutionForZoom(11.9, 10)).toBe(10);
    expect(displayResolutionForZoom(11.8, 10)).toBe(9);
    expect(displayResolutionForZoom(10.1, 9)).toBe(9);
    expect(displayResolutionForZoom(9.9, 9)).toBe(9);
    expect(displayResolutionForZoom(9.8, 9)).toBe(8);
  });

  it("handles large zoom jumps and invalid camera events", () => {
    expect(displayResolutionForZoom(3, 10)).toBe(5);
    expect(displayResolutionForZoom(18, 5)).toBe(10);
    expect(displayResolutionForZoom(Number.NaN, 9)).toBe(9);
  });

  it("merges siblings into one coarse hex without changing the input", () => {
    const parent = cellToParent(cell, 10);
    const children = Object.freeze(cellToChildren(parent, 11));
    expect(cellIdsAtDisplayResolution(children, 10)).toEqual([parent]);
    expect(cellIdsAtDisplayResolution([cell], 10)).toEqual([parent]);
    expect(children.every((id) => getResolution(id) === 11)).toBe(true);
  });

  it("restores sparse coverage at the finest display size after zooming back in", () => {
    const siblings = cellToChildren(cellToParent(cell, 9), 11);
    const visited = [siblings[0]!, siblings[40]!];
    expect(cellIdsAtDisplayResolution(visited, 8)).toHaveLength(1);
    expect(cellIdsAtDisplayResolution(visited, 10)).toEqual(
      visited.map((id) => cellToParent(id, 10)),
    );
  });

  it("supports all display levels, deduplicates inputs, and handles empty coverage", () => {
    for (let resolution = 5; resolution <= 10; resolution++) {
      expect(cellIdsAtDisplayResolution([cell, cell], resolution)).toEqual([cellToParent(cell, resolution)]);
      expect(cellIdsAtDisplayResolution([], resolution)).toEqual([]);
    }
  });

  it("rejects mixed source resolutions and invalid display resolutions", () => {
    expect(() => cellIdsAtDisplayResolution([cellToParent(cell, 10)], 9)).toThrow(/canonical/);
    for (const resolution of [4, 11, 12, 5.5, Number.NaN]) {
      expect(() => cellIdsAtDisplayResolution([cell], resolution)).toThrow(RangeError);
    }
  });
});
