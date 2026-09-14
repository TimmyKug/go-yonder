# Bundled country boundaries

Source: Natural Earth v5.1.2, 1:10m Admin 0 Countries.

- Source file: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson
- Dataset: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/
- Public domain: https://www.naturalearthdata.com/about/terms-of-use/

Regenerate with `node scripts/prepare-countries.mjs /path/to/source.geojson`.
Features are grouped by `SOV_A3` / `SOVEREIGNT`, excluding Antarctica.
Dependencies count toward their sovereign country. This follows Natural Earth's
boundary definitions, not a fixed UN-member-country list.

`countries.json` is simplified to 0.05 degrees and reused for wide-zoom
rendering, offline point assignment, and coverage clipping. At zoom 5 this is
roughly one screen pixel of geometric detail. Countries smaller than 5,000 km²
retain their source geometry so microstates and small islands remain
discoverable. `areaKm2` is calculated from the unsimplified polygons before
simplification. These are cartographic estimates, especially near coasts and
borders.
