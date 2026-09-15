// Input: the prepared src/data/countries/countries.json.
// Optional second input: a Natural Earth admin-0 countries GeoJSON, used only to
// add Antarctica, which the coverage data deliberately excludes from visits.
// Run: node scripts/prepare-globe.mjs [/path/to/ne_110m_admin_0_countries.geojson]
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

const antarcticaSource = process.argv[2];
if (antarcticaSource) {
  const source = JSON.parse(await readFile(antarcticaSource, "utf8"));
  const antarctica = source.features.find(({ properties }) => properties.ADMIN === "Antarctica");
  if (!antarctica) throw new Error("No Antarctica feature in the provided source");
  const rings = antarctica.geometry.coordinates
    .map((polygon) => polygon[0])
    .map((ring) => ({ ring, km2: area({ type: "Polygon", coordinates: [ring] }) / 1e6 }))
    .filter(({ km2 }) => km2 >= MIN_ISLAND_KM2)
    .map(({ ring }) => simplifyRing(ring).flat());
  features.push({ id: "ATA", name: "Antarctica", rings });
  features.sort((a, b) => a.name.localeCompare(b.name));
}

const rounded = (_key, value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);
await writeFile("src/data/countries/globe.json", JSON.stringify({ features }, rounded));
const points = features.reduce((total, { rings }) => total + rings.reduce((sum, ring) => sum + ring.length / 2, 0), 0);
console.log(`Prepared ${features.length} globe outlines with ${points} points.`);
