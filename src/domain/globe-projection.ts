/** Orthographic globe projection: the hemisphere facing the viewer, drawn as SVG paths. */

export type GlobeRotation = { latitude: number; longitude: number };
export type GlobeRing = readonly number[];
export type GlobeFeature = { id: string; name: string; rings: readonly GlobeRing[] };
export type GlobeOutline = { id: string; name: string; path: string };
/** Where the centre of the sphere sits on the canvas it is drawn into. */
export type GlobeCentre = { x: number; y: number };

const DEGREES = Math.PI / 180;
const MIN_RUN_POINTS = 3;
/** Keeps the radius finite when the camera sits on a pole. */
const MIN_POLE_COSINE = 0.05;
/** Ceiling on the sphere's radius, in viewport widths. */
const MAX_RADIUS_VIEWPORTS = 4;

/** The globe only ever takes over from a wide view, never from a street view. */
export const GLOBE_HANDOFF_MAX_ZOOM = 4;
const STALL_ZOOM_EPSILON = 0.01;
const STALL_CENTRE_EPSILON = 0.35;
const RECENT_ZOOM_OUT_MS = 1500;

export type CameraSample = {
  atMs: number;
  center: readonly [longitude: number, latitude: number];
  userInteraction: boolean;
  zoom: number;
};

/**
 * True when the user is still working the map but it has stopped zooming out:
 * MapLibre Native refuses to shrink the world below its viewport, so the pinch
 * stalls at a floor of roughly zoom 2.3. That stall is the moment to hand over
 * to the globe. A pan is excluded by requiring the centre to hold still, and a
 * idle map by requiring a zoom-out in the last moment and a wide view.
 */
export function isAtZoomFloor(
  previous: CameraSample | undefined,
  next: CameraSample,
  lastZoomOutMs: number | undefined,
): boolean {
  if (!next.userInteraction || next.zoom > GLOBE_HANDOFF_MAX_ZOOM) return false;
  if (!previous || lastZoomOutMs === undefined) return false;
  if (next.atMs - lastZoomOutMs > RECENT_ZOOM_OUT_MS) return false;
  if (Math.abs(previous.zoom - next.zoom) > STALL_ZOOM_EPSILON) return false;
  return (
    Math.abs(previous.center[0] - next.center[0]) < STALL_CENTRE_EPSILON &&
    Math.abs(previous.center[1] - next.center[1]) < STALL_CENTRE_EPSILON
  );
}

/**
 * Radius of the sphere the flat map implies, read from what the camera actually
 * shows rather than from an assumed tile size. Web Mercator spreads `width`
 * layout units over the visible longitude span, and its ground scale at the
 * centre latitude is that spread divided by cos(latitude); an orthographic
 * sphere of this radius has the same ground scale at the middle of its disc, so
 * the two line up where the viewer is looking.
 */
export function globeRadiusForViewport(
  width: number,
  bounds: readonly [west: number, south: number, east: number, north: number],
  latitude: number,
): number {
  const [west, , east] = bounds;
  const span = east - west > 0 ? east - west : east - west + 360;
  if (!(width > 0) || !(span > 0)) return 0;
  const mercatorRadius = width / (span * DEGREES);
  const matched = mercatorRadius / Math.max(Math.cos(latitude * DEGREES), MIN_POLE_COSINE);
  // A sphere far larger than the screen shows nothing extra and only inflates
  // the geometry, so it is capped well beyond what the viewport can reveal.
  return Math.min(matched, width * MAX_RADIUS_VIEWPORTS);
}

/** How far two fingers must spread before the globe hands back to the map. */
const PINCH_IN_RATIO = 1.18;

/** True once a two-finger spread is decisive enough to read as "zoom back in". */
export function isPinchingIn(startDistance: number, currentDistance: number): boolean {
  if (!(startDistance > 0) || !(currentDistance > 0)) return false;
  return currentDistance / startDistance >= PINCH_IN_RATIO;
}

/** Radius that seats the whole sphere on screen once it leaves the map's scale. */
export function globeFitRadius(width: number, height: number): number {
  return Math.min(width, height) * 0.42;
}

/** Ease-out, so the sphere settles into place instead of stopping dead. */
export function globeHandoffEase(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - (1 - clamped) ** 3;
}

/**
 * Radius during the handoff: the map's own scale at the start, the fitted
 * sphere at the end.
 */
export function globeHandoffRadius(
  matchedRadius: number,
  fitRadius: number,
  progress: number,
): number {
  const eased = globeHandoffEase(progress);
  return matchedRadius + (fitRadius - matchedRadius) * eased;
}

function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/** Drag deltas in degrees; latitude is clamped so the globe never flips over a pole. */
export function rotateToward(
  rotation: GlobeRotation,
  deltaLongitude: number,
  deltaLatitude: number,
): GlobeRotation {
  return {
    latitude: Math.min(90, Math.max(-90, rotation.latitude + deltaLatitude)),
    longitude: wrapLongitude(rotation.longitude + deltaLongitude),
  };
}

/**
 * Project one coordinate onto a globe of `radius` centred at `centre`.
 * Returns undefined for the hemisphere facing away from the viewer.
 */
export function projectToGlobe(
  longitude: number,
  latitude: number,
  rotation: GlobeRotation,
  radius: number,
  centre: GlobeCentre,
): { x: number; y: number } | undefined {
  const phi = latitude * DEGREES;
  const phi0 = rotation.latitude * DEGREES;
  const lambda = (longitude - rotation.longitude) * DEGREES;
  const cosPhi = Math.cos(phi);
  const cosLambda = Math.cos(lambda);
  if (Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * cosPhi * cosLambda < 0) return undefined;
  return {
    x: centre.x + radius * cosPhi * Math.sin(lambda),
    y: centre.y - radius * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * cosPhi * cosLambda),
  };
}

/**
 * One SVG path per country, covering every visible run of its outline. Runs broken by
 * the horizon are closed along the chord between their end points, which reads as a
 * clean limb at country scale. Paths may fall outside the canvas: the sphere is often
 * wider than the screen, and the canvas clips it.
 */
export function globeOutlines(
  features: readonly GlobeFeature[],
  rotation: GlobeRotation,
  radius: number,
  centre: GlobeCentre,
): GlobeOutline[] {
  const outlines: GlobeOutline[] = [];
  for (const { id, name, rings } of features) {
    let path = "";
    for (const ring of rings) {
      let run: string[] = [];
      for (let index = 0; index < ring.length; index += 2) {
        const point = projectToGlobe(ring[index]!, ring[index + 1]!, rotation, radius, centre);
        if (point) {
          run.push(`${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
          continue;
        }
        if (run.length >= MIN_RUN_POINTS) path += `M${run.join("L")}Z`;
        run = [];
      }
      if (run.length >= MIN_RUN_POINTS) path += `M${run.join("L")}Z`;
    }
    if (path) outlines.push({ id, name, path });
  }
  return outlines;
}
