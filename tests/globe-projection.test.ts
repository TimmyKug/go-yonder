import { describe, expect, it } from "vitest";

import { globeOutlines, projectToGlobe, rotateToward, type GlobeFeature } from "../src/domain/globe-projection";

const RADIUS = 100;
const FACING: GlobeFeature = {
  id: "FAC",
  name: "Facing",
  rings: [[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]],
};
const BEHIND: GlobeFeature = {
  id: "BEH",
  name: "Behind",
  rings: [[175, 0, -175, 0, -175, 10, 175, 10, 175, 0]],
};

describe("orthographic globe projection", () => {
  it("places the rotation centre at the middle of the disc", () => {
    expect(projectToGlobe(13, 52, { latitude: 52, longitude: 13 }, RADIUS)).toEqual({
      x: RADIUS,
      y: RADIUS,
    });
  });

  it("hides the hemisphere facing away from the viewer", () => {
    expect(projectToGlobe(180, 0, { latitude: 0, longitude: 0 }, RADIUS)).toBeUndefined();
    expect(projectToGlobe(91, 0, { latitude: 0, longitude: 0 }, RADIUS)).toBeUndefined();
    expect(projectToGlobe(89, 0, { latitude: 0, longitude: 0 }, RADIUS)).toBeDefined();
  });

  it("keeps every projected point inside the disc", () => {
    for (const longitude of [-89, -45, 0, 45, 89]) {
      for (const latitude of [-80, -30, 0, 30, 80]) {
        const point = projectToGlobe(longitude, latitude, { latitude: 0, longitude: 0 }, RADIUS)!;
        const distance = Math.hypot(point.x - RADIUS, point.y - RADIUS);
        expect(distance).toBeLessThanOrEqual(RADIUS + 1e-9);
      }
    }
  });

  it("puts north above the centre and east to its right", () => {
    const north = projectToGlobe(0, 30, { latitude: 0, longitude: 0 }, RADIUS)!;
    const east = projectToGlobe(30, 0, { latitude: 0, longitude: 0 }, RADIUS)!;
    expect(north.y).toBeLessThan(RADIUS);
    expect(north.x).toBeCloseTo(RADIUS, 6);
    expect(east.x).toBeGreaterThan(RADIUS);
    expect(east.y).toBeCloseTo(RADIUS, 6);
  });

  it("clamps rotation at the poles and wraps it around the globe", () => {
    expect(rotateToward({ latitude: 80, longitude: 0 }, 0, 40)).toEqual({ latitude: 90, longitude: 0 });
    expect(rotateToward({ latitude: -80, longitude: 0 }, 0, -40)).toEqual({ latitude: -90, longitude: 0 });
    expect(rotateToward({ latitude: 0, longitude: 170 }, 20, 0)).toEqual({ latitude: 0, longitude: -170 });
    expect(rotateToward({ latitude: 0, longitude: -170 }, -20, 0)).toEqual({ latitude: 0, longitude: 170 });
  });

  it("emits a closed path only for countries with visible outline", () => {
    const outlines = globeOutlines([FACING, BEHIND], { latitude: 0, longitude: 0 }, RADIUS);
    expect(outlines.map(({ id }) => id)).toEqual(["FAC"]);
    expect(outlines[0]!.path).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
  });

  it("drops runs too short to fill and keeps the rest of a straddling outline", () => {
    const straddling: GlobeFeature = {
      id: "STR",
      name: "Straddling",
      rings: [[0, 0, 20, 0, 20, 20, 0, 20, 0, 0, 179, 0, 179, 1]],
    };
    const [outline] = globeOutlines([straddling], { latitude: 0, longitude: 0 }, RADIUS);
    expect(outline!.path.match(/M/g)).toHaveLength(1);
  });
});
