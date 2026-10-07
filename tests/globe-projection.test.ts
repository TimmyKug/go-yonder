import { describe, expect, it } from "vitest";

import {
  globeLayers,
  projectToGlobe,
  rotateToward,
  type GlobeFeature,
} from "../src/domain/globe-projection";

const RADIUS = 100;
const CENTRE = { x: RADIUS, y: RADIUS };
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
    expect(projectToGlobe(13, 52, { latitude: 52, longitude: 13 }, RADIUS, CENTRE)).toEqual({
      x: RADIUS,
      y: RADIUS,
    });
  });

  it("hides the hemisphere facing away from the viewer", () => {
    expect(projectToGlobe(180, 0, { latitude: 0, longitude: 0 }, RADIUS, CENTRE)).toBeUndefined();
    expect(projectToGlobe(91, 0, { latitude: 0, longitude: 0 }, RADIUS, CENTRE)).toBeUndefined();
    expect(projectToGlobe(89, 0, { latitude: 0, longitude: 0 }, RADIUS, CENTRE)).toBeDefined();
  });

  it("keeps every projected point inside the disc", () => {
    for (const longitude of [-89, -45, 0, 45, 89]) {
      for (const latitude of [-80, -30, 0, 30, 80]) {
        const point = projectToGlobe(longitude, latitude, { latitude: 0, longitude: 0 }, RADIUS, CENTRE)!;
        const distance = Math.hypot(point.x - RADIUS, point.y - RADIUS);
        expect(distance).toBeLessThanOrEqual(RADIUS + 1e-9);
      }
    }
  });

  it("puts north above the centre and east to its right", () => {
    const north = projectToGlobe(0, 30, { latitude: 0, longitude: 0 }, RADIUS, CENTRE)!;
    const east = projectToGlobe(30, 0, { latitude: 0, longitude: 0 }, RADIUS, CENTRE)!;
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
    const { land, visited } = globeLayers([FACING, BEHIND], new Set(), { latitude: 0, longitude: 0 }, RADIUS, CENTRE);
    expect(land).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
    expect(visited).toBe("");
  });

  it("splits visible land into unvisited and visited layers", () => {
    const west: GlobeFeature = { id: "WES", name: "West", rings: [[-20, 0, -10, 0, -10, 10, -20, 10, -20, 0]] };
    const rotation = { latitude: 0, longitude: 0 };
    const alone = globeLayers([FACING], new Set(), rotation, RADIUS, CENTRE).land;
    const layers = globeLayers([FACING, west, BEHIND], new Set(["FAC", "BEH"]), rotation, RADIUS, CENTRE);
    expect(layers.visited).toBe(alone);
    expect(layers.land.match(/M/g)).toHaveLength(1);
    expect(layers.land).not.toBe(alone);
  });

  it("drops runs too short to fill and keeps the rest of a straddling outline", () => {
    const straddling: GlobeFeature = {
      id: "STR",
      name: "Straddling",
      rings: [[0, 0, 20, 0, 20, 20, 0, 20, 0, 0, 179, 0, 179, 1]],
    };
    const { land } = globeLayers([straddling], new Set(), { latitude: 0, longitude: 0 }, RADIUS, CENTRE);
    expect(land.match(/M/g)).toHaveLength(1);
  });

  it("draws the sphere around any centre, not just its own box", () => {
    const offset = projectToGlobe(0, 0, { latitude: 0, longitude: 0 }, RADIUS, { x: 500, y: 700 });
    expect(offset).toEqual({ x: 500, y: 700 });
  });

  it("draws the same points as projecting each coordinate", () => {
    for (const rotation of [
      { latitude: 0, longitude: 0 },
      { latitude: 35, longitude: -20 },
      { latitude: -20, longitude: 15 },
    ]) {
      const ring = FACING.rings[0]!;
      const expected: string[] = [];
      for (let index = 0; index < ring.length; index += 2) {
        const point = projectToGlobe(ring[index]!, ring[index + 1]!, rotation, RADIUS, CENTRE);
        if (point) expected.push(`${Math.round(point.x * 10) / 10} ${Math.round(point.y * 10) / 10}`);
      }
      const { land } = globeLayers([FACING], new Set(), rotation, RADIUS, CENTRE);
      const drawn = land.slice(1, -1).split("L");
      // The closing point repeats the first one and may round to the same position.
      expect(drawn).toEqual(expected.filter((point, index) => index === 0 || point !== expected[index - 1]));
    }
  });

  it("keeps a country whose centre is behind the horizon but whose edge is visible", () => {
    const wide: GlobeFeature = {
      id: "WID",
      name: "Wide",
      rings: [[70, -10, 80, -10, 100, -10, 130, -10, 130, 10, 100, 10, 80, 10, 70, 10, 70, -10]],
    };
    const { land } = globeLayers([wide], new Set(), { latitude: 0, longitude: 0 }, RADIUS, CENTRE);
    expect(land.match(/M/g)).toHaveLength(1);
  });

  it("draws points that round to the same position once", () => {
    const tiny: GlobeFeature = {
      id: "TIN",
      name: "Tiny",
      rings: [[0, 0, 0.0001, 0, 10, 0, 10, 10, 0, 10, 0, 0]],
    };
    const { land } = globeLayers([tiny], new Set(), { latitude: 0, longitude: 0 }, RADIUS, CENTRE);
    expect(land.split("L")).toHaveLength(5);
  });

});
