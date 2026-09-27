/** Orthographic globe projection: the hemisphere facing the viewer, drawn as SVG paths. */

export type GlobeRotation = { latitude: number; longitude: number };
export type GlobeRing = readonly number[];
export type GlobeFeature = { id: string; name: string; rings: readonly GlobeRing[] };
export type GlobeLayers = { land: string; visited: string };
/** Where the centre of the sphere sits on the canvas it is drawn into. */
export type GlobeCentre = { x: number; y: number };

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

/** Rounds to a tenth of a pixel; cheaper than `toFixed` on Hermes, which runs per point per frame. */
function coordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Every visible run of one country's outline as SVG subpaths, or "" when none is
 * visible. Runs broken by the horizon are closed along the chord between their end
 * points, which reads as a clean limb at country scale. Paths may fall outside the
 * canvas: the sphere is often wider than the screen, and the canvas clips it.
 */
function featurePath(
  rings: readonly GlobeRing[],
  rotation: GlobeRotation,
  radius: number,
  centre: GlobeCentre,
): string {
  let path = "";
  for (const ring of rings) {
    let run: string[] = [];
    for (let index = 0; index < ring.length; index += 2) {
      const point = projectToGlobe(ring[index]!, ring[index + 1]!, rotation, radius, centre);
      if (point) {
        run.push(`${coordinate(point.x)} ${coordinate(point.y)}`);
        continue;
      }
      if (run.length >= MIN_RUN_POINTS) path += `M${run.join("L")}Z`;
      run = [];
    }
    if (run.length >= MIN_RUN_POINTS) path += `M${run.join("L")}Z`;
  }
  return path;
}

/**
 * All visible land as two SVG paths, unvisited and visited. The outlines are outer
 * rings that never overlap, so one combined path fills exactly like one path per
 * country, while the renderer redraws two native shapes per frame instead of ~200.
 */
export function globeLayers(
  features: readonly GlobeFeature[],
  visitedIds: ReadonlySet<string>,
  rotation: GlobeRotation,
  radius: number,
  centre: GlobeCentre,
): GlobeLayers {
  let land = "";
  let visited = "";
  for (const { id, rings } of features) {
    const path = featurePath(rings, rotation, radius, centre);
    if (visitedIds.has(id)) visited += path;
    else land += path;
  }
  return { land, visited };
}
