/**
 * Orthographic globe: the outlines are painted once onto an equirectangular
 * world texture, and a shader samples it for each pixel of the sphere.
 */

export type GlobeRotation = { latitude: number; longitude: number };
export type GlobeRing = readonly number[];
export type GlobeFeature = { id: string; name: string; rings: readonly GlobeRing[] };
export type GlobeMapPaths = { land: string; visited: string };
/** Where the centre of the sphere sits on the canvas it is drawn into. */
export type GlobeCentre = { x: number; y: number };

const DEGREES = Math.PI / 180;
const MIN_TEXTURE_WIDTH = 1024;
const MAX_TEXTURE_WIDTH = 4096;

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
 * The coordinate shown at a canvas point, or undefined off the sphere. This is
 * the inverse of `projectToGlobe`, and the sphere shader computes the same.
 */
export function globePointToCoordinate(
  x: number,
  y: number,
  rotation: GlobeRotation,
  radius: number,
  centre: GlobeCentre,
): { longitude: number; latitude: number } | undefined {
  const across = (x - centre.x) / radius;
  const up = (centre.y - y) / radius;
  const remaining = 1 - across * across - up * up;
  if (remaining < 0) return undefined;
  const depth = Math.sqrt(remaining);
  const sinLat = Math.sin(rotation.latitude * DEGREES);
  const cosLat = Math.cos(rotation.latitude * DEGREES);
  const along = cosLat * depth - sinLat * up;
  const z = sinLat * depth + cosLat * up;
  return {
    longitude: wrapLongitude(rotation.longitude + Math.atan2(across, along) / DEGREES),
    latitude: Math.asin(Math.max(-1, Math.min(1, z))) / DEGREES,
  };
}

/**
 * The world texture's size: about the sphere's circumference in device pixels,
 * so the texture is not magnified at the centre of the sphere.
 */
export function globeTextureSize(radiusPx: number): { width: number; height: number } {
  const circumference = Math.ceil((2 * Math.PI * radiusPx) / 256) * 256;
  const width = Math.min(MAX_TEXTURE_WIDTH, Math.max(MIN_TEXTURE_WIDTH, circumference));
  return { width, height: width / 2 };
}

/** One ring in texture pixels: longitude −180…180 left to right, latitude 90…−90 top to bottom. */
function ringPath(ring: GlobeRing, width: number, height: number): string {
  let path = "";
  for (let index = 0; index + 1 < ring.length; index += 2) {
    const x = Math.round(((ring[index]! + 180) / 360) * width * 10) / 10;
    const y = Math.round(((90 - ring[index + 1]!) / 180) * height * 10) / 10;
    path += `${index === 0 ? "M" : "L"}${x} ${y}`;
  }
  return path.length > 0 ? `${path}Z` : "";
}

/**
 * All outlines as two SVG paths on the world texture, unvisited and visited.
 * The source rings are already cut at the antimeridian, so none wraps across
 * the texture's edges; Antarctica's ring runs along the bottom edge.
 */
export function globeMapPaths(
  features: readonly GlobeFeature[],
  visitedIds: ReadonlySet<string>,
  width: number,
  height: number,
): GlobeMapPaths {
  let land = "";
  let visited = "";
  for (const feature of features) {
    let path = "";
    for (const ring of feature.rings) path += ringPath(ring, width, height);
    if (visitedIds.has(feature.id)) visited += path;
    else land += path;
  }
  return { land, visited };
}
