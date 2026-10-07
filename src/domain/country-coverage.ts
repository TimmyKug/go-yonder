import { area } from "@turf/area";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { intersect } from "@turf/intersect";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { cellToBoundary, cellToLatLng, getResolution } from "h3-js";

// Each visited cell marks its whole coverage hex as explored: about 250 km² for
// countries. Regions are much smaller, so they use finer hexes of about 5 km².
export const COUNTRY_COVERAGE_RESOLUTION = 5;
export const REGION_COVERAGE_RESOLUTION = 7;
export const COUNTRY_OVERVIEW_ZOOM = 7;

type AreaProperties = { id: string; name: string; areaKm2: number };
export type CountryProperties = AreaProperties;
export type RegionProperties = AreaProperties & { countryId: string };
export type RegionCollection = FeatureCollection<MultiPolygon, RegionProperties>;
export type RegionVisit = RegionProperties & {
  firstSeenAtMs: number;
  exploredAreaKm2: number;
  uncoveredPercent: number;
  coveragePending: boolean;
};
export type CountryFeature = Feature<MultiPolygon, CountryProperties>;
export type CountryCollection = FeatureCollection<MultiPolygon, CountryProperties>;
export type CountryVisit = CountryProperties & {
  firstSeenAtMs: number;
  exploredAreaKm2: number;
  uncoveredPercent: number;
  /** True while some explored hexes still await their clipped area. */
  coveragePending: boolean;
};
type Box = [number, number, number, number];
type Part<P> = { area: P; feature: Feature<Polygon>; box: Box };

function bounds(ring: Position[]): Box {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const position of ring) {
    west = Math.min(west, position[0]!);
    east = Math.max(east, position[0]!);
    south = Math.min(south, position[1]!);
    north = Math.max(north, position[1]!);
  }
  return [west, south, east, north];
}

function overlaps(a: Box, b: Box) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Assigns cells to areas (countries or regions) and clips coarse hexes to an
 * area. Full boundaries are only used for local assignment and clipped coverage.
 */
export class AreaIndex<P extends AreaProperties> {
  private readonly parts: Part<P>[];
  private readonly buckets = new Map<string, Part<P>[]>();
  private readonly assignments = new Map<string, P | null>();
  private readonly coverageAreas = new Map<string, number>();

  constructor(collection: FeatureCollection<MultiPolygon, P>) {
    // Smaller areas first, so an enclave wins over the area around it.
    this.parts = collection.features.flatMap(({ properties, geometry }) =>
      geometry.coordinates.map((coordinates) => ({
        area: properties,
        box: bounds(coordinates[0]!),
        feature: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } } as Feature<Polygon>,
      })),
    ).sort((a, b) => a.area.areaKm2 - b.area.areaKm2);
  }

  areaForCell(cellId: string): P | null {
    if (getResolution(cellId) !== 11) throw new Error("Visits require resolution-11 cells");
    const cached = this.assignments.get(cellId);
    if (cached !== undefined) return cached;
    const [latitude, longitude] = cellToLatLng(cellId);
    const west = Math.floor(longitude), south = Math.floor(latitude);
    const key = `${west}:${south}`;
    let candidates = this.buckets.get(key);
    if (!candidates) {
      candidates = this.parts.filter(({ box }) => overlaps(box, [west, south, west + 1, south + 1]));
      if (this.buckets.size >= 4096) this.buckets.clear();
      this.buckets.set(key, candidates);
    }
    const area = candidates.find(({ feature, box }) =>
      overlaps(box, [longitude, latitude, longitude, latitude]) &&
      booleanPointInPolygon([longitude, latitude], feature),
    )?.area ?? null;
    if (this.assignments.size >= 50000) this.assignments.clear();
    this.assignments.set(cellId, area);
    return area;
  }

  coveredAreaKm2(parentId: string, areaId: string): number {
    const key = `${areaId}:${parentId}`;
    const cached = this.coverageAreas.get(key);
    if (cached !== undefined) return cached;
    const raw = cellToBoundary(parentId, true);
    // Unwrap the hex before clipping at the date line. Shift copies back to
    // both sides of the world's longitude interval to match country polygons.
    const ring: Position[] = [];
    for (const [longitude, latitude] of raw) {
      let x = longitude;
      const previous = ring.at(-1)?.[0] ?? x;
      while (x - previous > 180) x -= 360;
      while (x - previous < -180) x += 360;
      ring.push([x, latitude]);
    }
    ring.push([...ring[0]!]);
    let covered = 0;
    for (const shift of [-360, 0, 360]) {
      const shifted = ring.map(([x, y]) => [x! + shift, y!] as Position);
      const box = bounds(shifted);
      if (box[2] < -180 || box[0] > 180) continue;
      const hex: Feature<Polygon> = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [shifted] } };
      for (const part of this.parts) {
        if (part.area.id !== areaId || !overlaps(part.box, box)) continue;
        const clipped = intersect({ type: "FeatureCollection", features: [hex, part.feature] });
        if (clipped) covered += area(clipped) / 1e6;
      }
    }
    if (this.coverageAreas.size >= 20000) this.coverageAreas.clear();
    this.coverageAreas.set(key, covered);
    return covered;
  }
}

export class CountryIndex extends AreaIndex<CountryProperties> {
  countryForCell(cellId: string): CountryProperties | null {
    return this.areaForCell(cellId);
  }
}

/** Most discovered first; equal shares fall back to the name so the order is stable. */
export function compareByDiscovered(
  a: { name: string; uncoveredPercent: number },
  b: { name: string; uncoveredPercent: number },
): number {
  return b.uncoveredPercent - a.uncoveredPercent || a.name.localeCompare(b.name);
}

export function formatUncoveredPercent(percent: number): string {
  if (percent <= 0) return "0%";
  if (percent < 0.01) return "<0.01%";
  if (percent < 100 && percent >= 99.99) return ">99.99%";
  return `${percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}
