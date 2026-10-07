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

/** One outline as unit vectors on the sphere, packed x, y, z, so a frame needs no trigonometry. */
type PreparedRing = Float64Array;

/**
 * A country's outline on the unit sphere, with the smallest cap around it: the mean
 * direction and the cosine of the widest angle from it to any outline point.
 */
type PreparedFeature = {
  id: string;
  rings: PreparedRing[];
  capX: number;
  capY: number;
  capZ: number;
  capCos: number;
};

const preparedFeatures = new WeakMap<readonly GlobeFeature[], PreparedFeature[]>();

function prepareFeature({ id, rings }: GlobeFeature): PreparedFeature {
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  const prepared = rings.map((ring) => {
    const vectors = new Float64Array((ring.length / 2) * 3);
    for (let index = 0, offset = 0; index < ring.length; index += 2, offset += 3) {
      const lambda = ring[index]! * DEGREES;
      const phi = ring[index + 1]! * DEGREES;
      const cosPhi = Math.cos(phi);
      vectors[offset] = cosPhi * Math.cos(lambda);
      vectors[offset + 1] = cosPhi * Math.sin(lambda);
      vectors[offset + 2] = Math.sin(phi);
      sumX += vectors[offset]!;
      sumY += vectors[offset + 1]!;
      sumZ += vectors[offset + 2]!;
    }
    return vectors;
  });
  const length = Math.hypot(sumX, sumY, sumZ);
  // A degenerate mean (an outline wrapping the whole sphere) gets a cap that is never culled.
  if (length < 1e-9) return { id, rings: prepared, capX: 0, capY: 0, capZ: 1, capCos: -1 };
  const capX = sumX / length;
  const capY = sumY / length;
  const capZ = sumZ / length;
  let capCos = 1;
  for (const vectors of prepared) {
    for (let offset = 0; offset < vectors.length; offset += 3) {
      capCos = Math.min(
        capCos,
        vectors[offset]! * capX + vectors[offset + 1]! * capY + vectors[offset + 2]! * capZ,
      );
    }
  }
  return { id, rings: prepared, capX, capY, capZ, capCos };
}

function prepareFeatures(features: readonly GlobeFeature[]): PreparedFeature[] {
  let prepared = preparedFeatures.get(features);
  if (!prepared) {
    prepared = features.map(prepareFeature);
    preparedFeatures.set(features, prepared);
  }
  return prepared;
}

/** Sines and cosines of the rotation, computed once per frame rather than per point. */
type Frame = {
  sinLat: number;
  cosLat: number;
  sinLon: number;
  cosLon: number;
  radius: number;
  centre: GlobeCentre;
};

/**
 * Whether the whole cap lies beyond the horizon. The viewer faces the direction
 * `view`; the cap is hidden once its centre is more than 90° plus its own angular
 * radius away, which is cheaper to test than every point and exact enough to keep
 * every visible point.
 */
function isCapHidden(feature: PreparedFeature, frame: Frame): boolean {
  if (feature.capCos <= 0) return false;
  const facing =
    frame.cosLat * (feature.capX * frame.cosLon + feature.capY * frame.sinLon) +
    frame.sinLat * feature.capZ;
  return facing < -Math.sqrt(1 - feature.capCos * feature.capCos) - 1e-9;
}

/**
 * Every visible run of one ring as SVG subpaths. Runs broken by the horizon are
 * closed along the chord between their end points, which reads as a clean limb at
 * country scale. Consecutive points that round to the same position are drawn once.
 * Paths may fall outside the canvas: the sphere is often wider than the screen, and
 * the canvas clips it.
 */
function ringPath(vectors: PreparedRing, frame: Frame): string {
  const { sinLat, cosLat, sinLon, cosLon, radius, centre } = frame;
  let path = "";
  let run = "";
  let runPoints = 0;
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  for (let offset = 0; offset < vectors.length; offset += 3) {
    const x = vectors[offset]!;
    const y = vectors[offset + 1]!;
    const z = vectors[offset + 2]!;
    // Longitude relative to the rotation: cos φ cos Δλ and cos φ sin Δλ.
    const along = x * cosLon + y * sinLon;
    const across = y * cosLon - x * sinLon;
    if (sinLat * z + cosLat * along < 0) {
      if (runPoints >= MIN_RUN_POINTS) path += `M${run}Z`;
      run = "";
      runPoints = 0;
      lastX = Number.NaN;
      continue;
    }
    const screenX = coordinate(centre.x + radius * across);
    const screenY = coordinate(centre.y - radius * (cosLat * z - sinLat * along));
    if (screenX === lastX && screenY === lastY) continue;
    run += runPoints === 0 ? `${screenX} ${screenY}` : `L${screenX} ${screenY}`;
    runPoints += 1;
    lastX = screenX;
    lastY = screenY;
  }
  if (runPoints >= MIN_RUN_POINTS) path += `M${run}Z`;
  return path;
}

/**
 * All visible land as two SVG paths, unvisited and visited. The outlines are outer
 * rings that never overlap, so one combined path fills exactly like one path per
 * country, while the renderer redraws two native shapes per frame instead of ~200.
 * Outlines are converted to unit vectors once per feature list, and countries
 * entirely on the far side are skipped without projecting their points.
 */
export function globeLayers(
  features: readonly GlobeFeature[],
  visitedIds: ReadonlySet<string>,
  rotation: GlobeRotation,
  radius: number,
  centre: GlobeCentre,
): GlobeLayers {
  const frame: Frame = {
    sinLat: Math.sin(rotation.latitude * DEGREES),
    cosLat: Math.cos(rotation.latitude * DEGREES),
    sinLon: Math.sin(rotation.longitude * DEGREES),
    cosLon: Math.cos(rotation.longitude * DEGREES),
    radius,
    centre,
  };
  let land = "";
  let visited = "";
  for (const feature of prepareFeatures(features)) {
    if (isCapHidden(feature, frame)) continue;
    let path = "";
    for (const vectors of feature.rings) path += ringPath(vectors, frame);
    if (visitedIds.has(feature.id)) visited += path;
    else land += path;
  }
  return { land, visited };
}
