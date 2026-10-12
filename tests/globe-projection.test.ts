import { describe, expect, it } from "vitest";

import globeData from "../src/data/countries/globe.json";
import {
  globeMapPaths,
  globePointToCoordinate,
  globeTextureSize,
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
const VISITED: GlobeFeature = {
  id: "VIS",
  name: "Visited",
  rings: [[-180, 90, 180, 90, 180, -90, -180, -90]],
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

});

describe("globe shader inverse", () => {
  it("finds the coordinate that was projected to each point", () => {
    const rotations = [
      { latitude: 0, longitude: 0 },
      { latitude: 52, longitude: 13 },
      { latitude: -35, longitude: 150 },
      { latitude: 80, longitude: -170 },
    ];
    for (const rotation of rotations) {
      for (const longitude of [-179, -120, -60, 0, 45, 120, 179]) {
        for (const latitude of [-75, -30, 0, 30, 75]) {
          const point = projectToGlobe(longitude, latitude, rotation, RADIUS, CENTRE);
          if (!point) continue;
          const found = globePointToCoordinate(point.x, point.y, rotation, RADIUS, CENTRE)!;
          expect(found.latitude).toBeCloseTo(latitude, 6);
          // Longitudes are compared around the circle.
          expect(Math.cos((found.longitude - longitude) * Math.PI / 180)).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it("shows the rotation centre in the middle and nothing outside the disc", () => {
    const centre = globePointToCoordinate(RADIUS, RADIUS, { latitude: 52, longitude: 13 }, RADIUS, CENTRE)!;
    expect(centre.latitude).toBeCloseTo(52, 9);
    expect(centre.longitude).toBeCloseTo(13, 9);
    expect(globePointToCoordinate(0, 0, { latitude: 0, longitude: 0 }, RADIUS, CENTRE)).toBeUndefined();
  });
});

describe("world texture", () => {
  it("sizes the texture to the sphere's circumference within GPU-friendly bounds", () => {
    expect(globeTextureSize(100)).toEqual({ width: 1024, height: 512 });
    expect(globeTextureSize(480)).toEqual({ width: 3072, height: 1536 });
    expect(globeTextureSize(2000)).toEqual({ width: 4096, height: 2048 });
  });

  it("draws outlines in equirectangular texture pixels, split into land and visited", () => {
    const { land, visited } = globeMapPaths([FACING, VISITED], new Set(["VIS"]), 360, 180);
    expect(land).toBe("M180 90L190 90L190 80L180 80L180 90Z");
    expect(visited).toBe("M0 0L360 0L360 180L0 180Z");
  });

  it("relies on outlines that only cross the antimeridian along a pole", () => {
    const { features } = globeData as { features: GlobeFeature[] };
    for (const { rings } of features) {
      for (const ring of rings) {
        for (let index = 2; index < ring.length; index += 2) {
          if (Math.abs(ring[index]! - ring[index - 2]!) > 180) {
            expect(Math.abs(ring[index + 1]!)).toBe(90);
            expect(Math.abs(ring[index - 1]!)).toBe(90);
          }
        }
      }
    }
  });
});
