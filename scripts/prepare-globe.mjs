// Input: the prepared src/data/countries/countries.json.
// Run: node scripts/prepare-globe.mjs
import { readFile, writeFile } from "node:fs/promises";
import { area } from "@turf/area";
import { simplify } from "@turf/simplify";

const MIN_ISLAND_KM2 = 12000;
const TOLERANCE = 0.35;

/** Douglas-Peucker via turf, tolerant of the degenerate rings in the source data. */
function simplifyRing(ring) {
  if (ring.length < 5) return ring;
  try {
    const polygon = { type: "Polygon", coordinates: [ring] };
    const result = simplify(polygon, { tolerance: TOLERANCE, highQuality: false });
    const simplified = result.coordinates[0];
    return simplified.length >= 4 ? simplified : ring;
  } catch {
    return ring;
  }
}

const countries = JSON.parse(await readFile("src/data/countries/countries.json", "utf8"));
const features = [];
for (const { properties, geometry } of countries.features) {
  const rings = geometry.coordinates
    .map((polygon) => polygon[0])
    .filter((ring) => Array.isArray(ring) && ring.length >= 4)
    .map((ring) => ({ ring, km2: area({ type: "Polygon", coordinates: [ring] }) / 1e6 }))
    .sort((a, b) => b.km2 - a.km2);
  if (rings.length === 0) continue;
  const kept = rings.filter(({ km2 }) => km2 >= MIN_ISLAND_KM2);
  features.push({
    id: properties.id,
    name: properties.name,
    rings: (kept.length > 0 ? kept : rings.slice(0, 1)).map(({ ring }) => simplifyRing(ring).flat()),
  });
}

const rounded = (_key, value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);
await writeFile("src/data/countries/globe.json", JSON.stringify({ features }, rounded));
const points = features.reduce((total, { rings }) => total + rings.reduce((sum, ring) => sum + ring.length / 2, 0), 0);
console.log(`Prepared ${features.length} globe outlines with ${points} points.`);
