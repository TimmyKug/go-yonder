# Bundled region boundaries

Source: Natural Earth v5.1.2, 1:10m Admin 1 – States, Provinces.

- Source file: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson
- Dataset: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/
- Public domain: https://www.naturalearthdata.com/about/terms-of-use/

Regenerate with `node scripts/prepare-regions.mjs /path/to/source.geojson`
after `src/data/countries/countries.json`, which it reads to check that every
region belongs to a bundled country.

Each region keeps its `adm1_code` as `id`, its English name, and the country it
belongs to (`countryId`, the sovereign code used by the country grouping;
Israel's `ISR` maps to `IS1`). Antarctica is excluded. `areaKm2` is calculated
from the unsimplified polygons. Regions are simplified to 0.02 degrees (about
2 km); regions under 1,000 km² to 0.002 degrees. Coordinates keep four decimal
places.

Natural Earth's first-level divisions are not uniform: some countries use
states or provinces, others départements, counties or districts.
