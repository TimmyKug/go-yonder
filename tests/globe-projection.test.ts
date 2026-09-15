import { describe, expect, it } from "vitest";

import {
  isAtZoomFloor,
  isPinchingIn,
  type CameraSample,
  globeOutlines,
  globeFitRadius,
  globeHandoffEase,
  globeHandoffRadius,
  globeRadiusForViewport,
  projectToGlobe,
  rotateToward,
  type GlobeFeature,
} from "../src/domain/globe-projection";

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

  it("hands over when a zoom-out stalls at the renderer's floor", () => {
    const previous: CameraSample = { atMs: 1000, center: [13, 52], userInteraction: true, zoom: 2.34 };
    const stalled: CameraSample = { atMs: 1200, center: [13, 52], userInteraction: true, zoom: 2.34 };
    expect(isAtZoomFloor(previous, stalled, 900)).toBe(true);
  });

  it("does not hand over while panning, zooming, or sitting idle", () => {
    const previous: CameraSample = { atMs: 1000, center: [13, 52], userInteraction: true, zoom: 2.34 };
    const at = (overrides: Partial<CameraSample>): CameraSample => ({ ...previous, atMs: 1200, ...overrides });
    // Still zooming out, so the floor has not been reached.
    expect(isAtZoomFloor(previous, at({ zoom: 2.1 }), 900)).toBe(false);
    // Panning at the floor moves the centre.
    expect(isAtZoomFloor(previous, at({ center: [20, 52] }), 900)).toBe(false);
    // Nobody is touching the map.
    expect(isAtZoomFloor(previous, at({ userInteraction: false }), 900)).toBe(false);
    // The last zoom-out was too long ago, so this is just an idle wide map.
    expect(isAtZoomFloor(previous, at({}), undefined)).toBe(false);
    expect(isAtZoomFloor(previous, at({ atMs: 9000 }), 900)).toBe(false);
    // Street zoom never hands over, however the gesture stalls.
    expect(isAtZoomFloor({ ...previous, zoom: 14 }, at({ zoom: 14 }), 900)).toBe(false);
    // Nothing to compare against yet.
    expect(isAtZoomFloor(undefined, at({}), 900)).toBe(false);
  });

  it("sizes the sphere from what the camera shows", () => {
    // 360 degrees across 400 units is a whole world: radius = 400 / 2pi at the equator.
    expect(globeRadiusForViewport(400, [-180, -60, 180, 60], 0)).toBeCloseTo(400 / (2 * Math.PI), 6);
    // Half the longitude span at the same width means twice the radius.
    expect(globeRadiusForViewport(400, [-90, -60, 90, 60], 0)).toBeCloseTo(400 / Math.PI, 6);
    // Mercator stretches away from the equator, so the matching sphere grows.
    expect(globeRadiusForViewport(400, [-180, 0, 180, 80], 60)).toBeCloseTo(400 / Math.PI, 6);
  });

  it("handles a viewport that crosses the antimeridian or has no size", () => {
    expect(globeRadiusForViewport(400, [170, -10, -170, 10], 0)).toBeCloseTo(
      globeRadiusForViewport(400, [-10, -10, 10, 10], 0),
      6,
    );
    expect(globeRadiusForViewport(0, [-180, -60, 180, 60], 0)).toBe(0);
    // A camera over the pole would divide by ~0, so the cosine is clamped.
    const atPole = globeRadiusForViewport(400, [-180, -60, 180, 60], 90);
    expect(Number.isFinite(atPole)).toBe(true);
    expect(atPole).toBe(globeRadiusForViewport(400, [-180, -60, 180, 60], -90));
    expect(atPole).toBeGreaterThan(globeRadiusForViewport(400, [-180, -60, 180, 60], 60));
  });

  it("fits the whole sphere on screen once it leaves the map scale", () => {
    expect(globeFitRadius(400, 900)).toBeCloseTo(168, 6);
    expect(globeFitRadius(900, 400)).toBeCloseTo(168, 6);
    expect(globeFitRadius(400, 900) * 2).toBeLessThan(400);
  });

  it("eases the handoff and clamps it at both ends", () => {
    expect(globeHandoffEase(0)).toBe(0);
    expect(globeHandoffEase(1)).toBe(1);
    expect(globeHandoffEase(-1)).toBe(0);
    expect(globeHandoffEase(2)).toBe(1);
    expect(globeHandoffEase(0.5)).toBeGreaterThan(0.5);
    expect(globeHandoffEase(0.25)).toBeLessThan(globeHandoffEase(0.75));
  });

  it("moves the radius from the map's scale to the fitted sphere", () => {
    expect(globeHandoffRadius(540, 168, 0)).toBe(540);
    expect(globeHandoffRadius(540, 168, 1)).toBe(168);
    const midway = globeHandoffRadius(540, 168, 0.5);
    expect(midway).toBeLessThan(540);
    expect(midway).toBeGreaterThan(168);
  });

  it("reads a decisive two-finger spread as zooming back in", () => {
    expect(isPinchingIn(100, 130)).toBe(true);
    expect(isPinchingIn(100, 110)).toBe(false);
    expect(isPinchingIn(100, 60)).toBe(false);
    expect(isPinchingIn(0, 200)).toBe(false);
    expect(isPinchingIn(100, 0)).toBe(false);
  });
});
