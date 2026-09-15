/** Orthographic globe projection: the hemisphere facing the viewer, drawn as SVG paths. */

export type GlobeRotation = { latitude: number; longitude: number };
export type GlobeRing = readonly number[];
export type GlobeFeature = { id: string; name: string; rings: readonly GlobeRing[] };
export type GlobeOutline = { id: string; name: string; path: string };

const DEGREES = Math.PI / 180;
const MIN_RUN_POINTS = 3;

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
 * Project one coordinate onto a globe of `radius` centred at (radius, radius).
 * Returns undefined for the hemisphere facing away from the viewer.
 */
export function projectToGlobe(
  longitude: number,
  latitude: number,
  rotation: GlobeRotation,
  radius: number,
): { x: number; y: number } | undefined {
  const phi = latitude * DEGREES;
  const phi0 = rotation.latitude * DEGREES;
  const lambda = (longitude - rotation.longitude) * DEGREES;
  const cosPhi = Math.cos(phi);
  const cosLambda = Math.cos(lambda);
  if (Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * cosPhi * cosLambda < 0) return undefined;
  return {
    x: radius + radius * cosPhi * Math.sin(lambda),
    y: radius - radius * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * cosPhi * cosLambda),
  };
}

/**
 * One SVG path per country, covering every visible run of its outline. Runs broken by
 * the horizon are closed along the chord between their end points, which reads as a
 * clean limb at country scale.
 */
export function globeOutlines(
  features: readonly GlobeFeature[],
  rotation: GlobeRotation,
  radius: number,
): GlobeOutline[] {
  const outlines: GlobeOutline[] = [];
  for (const { id, name, rings } of features) {
    let path = "";
    for (const ring of rings) {
      let run: string[] = [];
      for (let index = 0; index < ring.length; index += 2) {
        const point = projectToGlobe(ring[index]!, ring[index + 1]!, rotation, radius);
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
