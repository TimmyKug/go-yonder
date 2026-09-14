# Bundled country boundaries

Source: Natural Earth v5.1.2, 1:10m Admin 0 Countries.

- Source file: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson
- Dataset: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/
- Public domain: https://www.naturalearthdata.com/about/terms-of-use/

Regenerate with `node scripts/prepare-countries.mjs /path/to/source.geojson`.
Features are grouped by `SOV_A3` / `SOVEREIGNT`, excluding Antarctica.
Dependencies count toward their sovereign country. This follows Natural Earth's
boundary definitions, not a fixed UN-member-country list.

`boundaries.json` retains source geometry rounded to five decimal places for
offline point assignment. `display.json` is simplified to 0.025 degrees for
wide-zoom rendering only. `areaKm2` uses the unsimplified polygons' spherical
area. These are cartographic estimates, especially near coasts and borders.
