import { describe, expect, it } from "vitest";
import { mapBoundsContain, nextCoverageBounds, padMapBounds } from "../src/domain/map-bounds";

describe("coverage preloading", () => {
  it("loads an extra viewport on every side", () => {
    expect(padMapBounds([10, 20, 12, 24])).toEqual([8, 16, 14, 28]);
  });

  it("reuses nearby coverage and preloads again before reaching its edge", () => {
    const loaded = padMapBounds([10, 20, 12, 24]);
    expect(nextCoverageBounds(loaded, [10.5, 20, 12.5, 24])).toBe(loaded);
    const panned = [11.5, 20, 13.5, 24] as const;
    expect(mapBoundsContain(loaded, [...panned])).toBe(true);
    expect(nextCoverageBounds(loaded, [...panned])).toEqual([9.5, 16, 15.5, 28]);
  });

  it("reloads on zoom out but reuses coverage on zoom in", () => {
    const loaded = padMapBounds([10, 20, 12, 24]);
    expect(nextCoverageBounds(loaded, [10.5, 21, 11.5, 23])).toBe(loaded);
    expect(nextCoverageBounds(loaded, [8, 16, 14, 28])).toEqual([2, 4, 20, 40]);
  });

  it("wraps across the antimeridian and tests containment across it", () => {
    const loaded = padMapBounds([179, 0, -179, 2]);
    expect(loaded).toEqual([177, -2, -177, 4]);
    expect(mapBoundsContain(loaded, [-180, 0, -178, 2])).toBe(true);
    expect(mapBoundsContain(loaded, [-178, 0, 178, 2])).toBe(false);
    expect(mapBoundsContain(loaded, [0, 0, 1, 2])).toBe(false);
  });

  it("clamps to the poles and loads all longitudes for a wide viewport", () => {
    expect(padMapBounds([-100, -80, 100, 80])).toEqual([-180, -90, 180, 90]);
    expect(mapBoundsContain([-180, -90, 180, 90], [170, -85, -170, 85])).toBe(true);
  });
});
