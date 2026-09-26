export type MapBounds = [west: number, south: number, east: number, north: number];

function longitudeWidth([west, , east]: MapBounds): number {
  return east >= west ? east - west : east - west + 360;
}

function wrapLongitude(value: number): number {
  return (((value + 180) % 360) + 360) % 360 - 180;
}

export function padMapBounds(bounds: MapBounds, margin = 1): MapBounds {
  const [west, south, east, north] = bounds;
  const width = longitudeWidth(bounds);
  const latitudePadding = Math.max(north - south, 0.002) * margin;
  const longitudePadding = Math.max(width, 0.002) * margin;
  const fullWorld = width + 2 * longitudePadding >= 360;
  return [
    fullWorld ? -180 : wrapLongitude(west - longitudePadding),
    Math.max(-90, south - latitudePadding),
    fullWorld ? 180 : wrapLongitude(east + longitudePadding),
    Math.min(90, north + latitudePadding),
  ];
}

export function mapBoundsContain(outer: MapBounds, inner: MapBounds): boolean {
  if (inner[1] < outer[1] || inner[3] > outer[3]) return false;
  const width = longitudeWidth(outer);
  if (width >= 360) return true;
  const offset = ((inner[0] - outer[0]) % 360 + 360) % 360;
  return offset + longitudeWidth(inner) <= width;
}

// Loaded coverage this much larger than a fresh load is dropped on zoom in, so
// street-level views do not redraw a whole zoomed-out region's tiles.
const MAX_COVERAGE_OVERSIZE = 2;

export function nextCoverageBounds(current: MapBounds, viewport: MapBounds): MapBounds {
  const target = padMapBounds(viewport);
  const oversized =
    longitudeWidth(current) > MAX_COVERAGE_OVERSIZE * longitudeWidth(target) ||
    current[3] - current[1] > MAX_COVERAGE_OVERSIZE * (target[3] - target[1]);
  return !oversized && mapBoundsContain(current, padMapBounds(viewport, 0.5))
    ? current
    : target;
}
