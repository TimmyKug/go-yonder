import type { Feature, FeatureCollection, Polygon, Position } from "geojson";

const EARTH_RADIUS_M = 6_371_008.8;
const CIRCLE_STEPS = 48;

/**
 * A closed polygon approximating every point within `radiusM` of a center, so
 * the map can draw a fix's uncertainty at its true ground size at any zoom.
 */
export function accuracyAreaPolygon(
  latitude: number,
  longitude: number,
  radiusM: number,
): Feature<Polygon> {
  const angularRadius = radiusM / EARTH_RADIUS_M;
  const lat = (latitude * Math.PI) / 180;
  const lng = (longitude * Math.PI) / 180;
  const ring: Position[] = [];

  for (let step = 0; step < CIRCLE_STEPS; step += 1) {
    const bearing = (2 * Math.PI * step) / CIRCLE_STEPS;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angularRadius) +
        Math.cos(lat) * Math.sin(angularRadius) * Math.cos(bearing),
    );
    const pointLng =
      lng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(lat),
        Math.cos(angularRadius) - Math.sin(lat) * Math.sin(pointLat),
      );
    ring.push([
      ((((pointLng * 180) / Math.PI + 540) % 360) - 180),
      (pointLat * 180) / Math.PI,
    ]);
  }
  ring.push([...ring[0]!]);

  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

export function accuracyAreaCollection(
  fix: { latitude: number; longitude: number; accuracyM: number } | undefined,
): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features:
      fix && Number.isFinite(fix.accuracyM) && fix.accuracyM > 0
        ? [accuracyAreaPolygon(fix.latitude, fix.longitude, fix.accuracyM)]
        : [],
  };
}

/** "±40 m", "±320 m", or "±1.2 km"; coarse so the label does not flicker. */
export function formatAccuracy(accuracyM: number): string {
  if (accuracyM >= 1000) return `±${(accuracyM / 1000).toFixed(1)} km`;
  if (accuracyM >= 100) return `±${Math.round(accuracyM / 10) * 10} m`;
  return `±${Math.round(accuracyM)} m`;
}
