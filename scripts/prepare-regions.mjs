// Input: Natural Earth v5.1.2 ne_10m_admin_1_states_provinces.geojson.
// Run: node scripts/prepare-regions.mjs /path/to/source.geojson
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { area } from "@turf/area";
import { simplify } from "@turf/simplify";

// About 2 km: regions are smaller than countries, so they keep more detail.
const TOLERANCE_DEGREES = 0.02;
// Small regions such as city districts keep more of their shape.
const SMALL_REGION_KM2 = 1000;
const SMALL_REGION_TOLERANCE_DEGREES = 0.002;

const source = JSON.parse(await readFile(process.argv[2], "utf8"));
const countries = JSON.parse(await readFile("src/data/countries/countries.json", "utf8"));
const countryIds = new Set(countries.features.map(({ properties }) => properties.id));

// Natural Earth uses a different sovereign code at admin-1 level for these.
const SOVEREIGN_ALIASES = new Map([["ISR", "IS1"]]);

const features = [];
const unmatched = new Set();
for (const feature of source.features) {
  const { adm1_code: id, sov_a3: sovereign, name_en: nameEn, name, admin } = feature.properties;
  const countryId = SOVEREIGN_ALIASES.get(sovereign) ?? sovereign;
  if (admin === "Antarctica" || !feature.geometry) continue;
  if (!id) throw new Error("Missing region identifier");
  if (!countryIds.has(countryId)) {
    unmatched.add(countryId);
    continue;
  }
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const full = { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polygons } };
  const areaKm2 = area(full) / 1e6;
  const tolerance = areaKm2 < SMALL_REGION_KM2 ? SMALL_REGION_TOLERANCE_DEGREES : TOLERANCE_DEGREES;
  const simplified = simplify(full, { tolerance, highQuality: true });
  // Keep the source shape of any polygon simplification would collapse.
  const coordinates = simplified.geometry.coordinates.map((polygon, index) =>
    polygon[0].length >= 4 ? polygon : polygons[index]);
  features.push({
    type: "Feature",
    id,
    properties: { id, countryId, name: nameEn || name || id, areaKm2 },
    geometry: { type: "MultiPolygon", coordinates },
  });
}
if (unmatched.size > 0) throw new Error(`Regions without a bundled country: ${[...unmatched].join(", ")}`);

features.sort((a, b) => a.properties.countryId.localeCompare(b.properties.countryId) || a.properties.name.localeCompare(b.properties.name));
await mkdir("src/data/regions", { recursive: true });
// Four decimal places are about 11 m, far below the simplification.
const rounded = (_key, value) => typeof value === "number" ? Math.round(value * 1e4) / 1e4 : value;
const text = JSON.stringify({ type: "FeatureCollection", features }, rounded);
await writeFile("src/data/regions/regions.json", text);
console.log(`Prepared ${features.length} regions (${(text.length / 1e6).toFixed(1)} MB).`);
