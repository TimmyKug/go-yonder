// Input: Natural Earth v5.1.2 ne_10m_admin_0_countries.geojson.
// Run: node scripts/prepare-countries.mjs /path/to/source.geojson
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { area } from "@turf/area";
import { simplify } from "@turf/simplify";

const source = JSON.parse(await readFile(process.argv[2], "utf8"));
const groups = new Map();
for (const feature of source.features) {
  const { SOV_A3: id, SOVEREIGNT: name, ADMIN: admin } = feature.properties;
  if (admin === "Antarctica") continue;
  if (!id || !name) throw new Error("Missing sovereign metadata");
  let country = groups.get(id);
  if (!country) {
    country = { type: "Feature", id, properties: { id, name, areaKm2: 0 }, geometry: { type: "MultiPolygon", coordinates: [] } };
    groups.set(id, country);
  }
  country.geometry.coordinates.push(...(feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates));
}
const features = [...groups.values()].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
for (const feature of features) feature.properties.areaKm2 = area(feature) / 1e6;
const full = { type: "FeatureCollection", features };
const countries = simplify(full, { tolerance: 0.05, highQuality: true });
const detailedSmallCountries = new Map(
  full.features
    .filter(({ properties }) => properties.areaKm2 < 5000)
    .map(({ properties, geometry }) => [properties.id, geometry]),
);
for (const feature of countries.features) {
  feature.geometry = detailedSmallCountries.get(feature.properties.id) ?? feature.geometry;
}
await mkdir("src/data/countries", { recursive: true });
const rounded = (_key, value) => typeof value === "number" ? Math.round(value * 1e5) / 1e5 : value;
await writeFile("src/data/countries/countries.json", JSON.stringify(countries, rounded));
console.log(`Prepared ${features.length} sovereign country groups.`);
