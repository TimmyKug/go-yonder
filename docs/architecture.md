# Architecture

This document describes how Yonder works today. Earlier decisions, alternatives,
and release history live in the git history.

## Product

**Yonder — Unveil your world.** Android package and iOS bundle identifier:
`com.timothykugler.yonder` (changing it would stop in-place Android updates).

- A full-screen native map on iOS and Android.
- Foreground and background location collection, within operating-system
  permission and lifecycle limits.
- Deterministic unlocking of H3 hexagons as valid locations are observed.
- Durable, device-local persistence with backup export and import.
- Visited countries with approximate explored percentages, and a globe view.
- No accounts, backend, analytics, cloud sync, or location uploads.

## Stack

- **Expo, React Native, strict TypeScript, Expo Router.** Routes and layouts
  live in `app/`; everything else in `src/`. MapLibre and background location
  need native modules, so development builds are the supported runtime, not
  Expo Go.
- **MapLibre React Native** renders the basemap and overlays natively. Coverage
  is supplied as batched GeoJSON sources rendered by fill and line layers, never
  as one React component per hexagon.
- **H3 (`h3-js` 4.5.0, pinned).** `h3-js` eagerly builds a UTF-16LE
  `TextDecoder` that Expo's native decoder rejects; `patches/h3-js+4.5.0.patch`
  removes only that unused initializer, and a regression test guards it.
  Re-evaluate the patch before upgrading H3 or Expo.
- **Expo SQLite** is the local source of truth.
- **Expo Location and Task Manager** deliver readings; the background task is
  defined at module scope.

## Data flow

```text
Live foreground GPS ─────┐
Live background GPS ─────┼──> NormalizedLocationSample
Future import adapter ───┘          │
                          validation / deduplication
                                    │
                               HexGrid (H3)
                                    │
                            YonderRepository
                         ┌──────────┴──────────┐
                 location_samples       unlocked_cells
                                    │
                         viewport-aware query
                                    │
                        GeoJSON sources + layers
```

Dependencies point inward: UI composes interfaces; domain code knows neither
Expo nor SQLite; adapters in `src/data` and `src/location` implement platform
and persistence details. UI components never issue SQL.

## Repository layout

```text
app/                    Expo Router routes: map, settings, countries, diagnostics
src/config/             H3 resolution, accuracy threshold, map styles
src/domain/             Pure logic: samples, ingestion, H3 grid, veil, map
                        bounds, country coverage, globe projection, accuracy area
src/data/               SQLite databases, migrations, repositories, backups,
                        bundled country data
src/location/           Permissions, foreground/background tracking, ingestion
src/countries/          Background country scan
src/diagnostics/        On-device diagnostics recorder and report
src/features/           Screens, map view, hooks, appearance, globe
src/import/             Source-neutral import adapter contract
src/map/                Native map network configuration
tests/                  Vitest suite; tests/support has a Node SQLite adapter
patches/                h3-js and MapLibre patches applied on postinstall
scripts/                Country/globe data preparation and iOS QA
```

## Domain contracts

```ts
type LocationSource = "live-foreground" | "live-background" | "external-import";

type NormalizedLocationSample = {
  source: LocationSource;
  sourceRecordId?: string;
  recordedAt: string; // UTC ISO-8601
  latitude: number;
  longitude: number;
  horizontalAccuracyM?: number;
  importBatchId?: string;
};

interface ImportAdapter {
  readonly sourceType: string;
  canRead(file: ImportFile): Promise<boolean>;
  read(file: ImportFile): AsyncIterable<NormalizedLocationSample>;
}
```

Live GPS and any future import enter through the same normalized contract. No
provider-specific adapter exists yet; one is added only after inspecting a real
export. Never assume an external provider uses H3.

## Persistence

The main database `yonder.db` runs in WAL mode with a 5 s busy timeout and
ordered, transactional migrations. Its schema version is 3. Backups depend on
that version, so any change needs a documented migration and import strategy.

| Table | Purpose |
| --- | --- |
| `location_samples` | Validated observations: source, optional source record ID, `recorded_at_ms`, WGS84 coordinate, accuracy, optional import batch, and a unique `fingerprint` that makes replays and re-imports idempotent. |
| `unlocked_cells` | Materialized coverage. Primary key `(cell_id, resolution)`; stores the cell center for viewport filtering and `first_seen_at_ms` / `last_seen_at_ms`. Revisits widen the time range. |
| `import_batches` | Reserved for future import traceability: source type, display file name, file hash, parser version, status, timestamps. Original import files are never retained. |

Separate SQLite files keep derived and diagnostic data out of backups and leave
the backup schema unchanged:

- `yonder-diagnostics.db`: the diagnostics log.
- `yonder-country-cache.db`: the rebuildable country summary.
- Expo SQLite's key-value store: the appearance preference and the live
  accuracy limit. The limit is read synchronously, so background tasks apply
  the current choice.

Exclusive transactions on the main database run on a separate Expo connection,
which gets its own 5 s busy timeout so concurrent background writes wait rather
than fail.

## Location and ingestion

- Foreground permission is requested before background permission is explained
  and requested; Android's settings transition is explained first.
- High accuracy, 20 m distance interval; at most one update per second in the
  foreground and one per three seconds in the background, with deferred
  batching in the background. Android runs a foreground-service notification
  while background tracking is active.
- On Android, when the app becomes active with background tracking registered,
  the task is registered again: Android restores tasks after a process restart
  without starting the foreground service, and re-registering restarts it.
- An already-authorized app requests one foreground fix on activation to seed
  the map; failing to get it never stops background collection.

For each sample:

1. Validate finite WGS84 coordinates and a valid timestamp.
2. Reject live readings less accurate than the chosen limit: **25, 50 or
   100 m** (default 100 m), set in Settings. They never unlock cells and are not
   stored. Imported history is not filtered by it.
3. Compute the fingerprint and the resolution-11 H3 cell.
4. In one transaction, insert the sample if new and upsert the cell's
   first/last-seen range.
5. Refresh the map after commit.

Only the cell containing each accepted observation is unlocked. The app never
interpolates between fixes.

The newest valid fix of any accuracy is kept in memory only as `latestFix` and
drawn on the map with a circle at its accuracy radius. Above the limit the dot and
circle turn amber, the circle is dashed, and the status pill reads "Weak GPS
signal · ±N m". This fix never unlocks cells, never replaces the saved
coordinate that triggers tile and country refreshes, and is never stored or
logged.

## Map

- **Basemap:** OpenFreeMap Positron (light) and Dark, with no API key.
  `EXPO_PUBLIC_MAP_STYLE_LIGHT_URL` and `EXPO_PUBLIC_MAP_STYLE_DARK_URL` can
  replace either complete style. In dark mode the style is fetched and its
  `place_*` labels are repainted white so they stay readable under the veil.
  Labels are thinned: no second non-Latin line, and no regions or cities until a
  country fills the viewport; countries label from zoom 1.5 (dependencies and
  disputed territories from 2.5).
- **Offline fallback:** if the online style fails to load, a bundled style draws
  water, land and every country border from the bundled Natural Earth data. The
  status pill shows "Offline map", the online style is retried on each return to
  the foreground, and the error screen appears only if the offline style also
  fails. It makes no network requests.
- **Controls:** status pill top-left, Settings top-right, recenter bottom-right,
  and an ⓘ button bottom-left. Actionable tracking warnings appear as a bottom
  card; normal tracking shows none.
- **About sheet:** ⓘ opens a bottom sheet with the app icon and version, a short
  note on why Yonder exists, a "Buy me a coffee" button that opens the page in
  the browser (nothing is embedded), and the tappable map credits
  (`© OpenStreetMap contributors`, and `© OpenMapTiles` via OpenFreeMap unless a
  custom style is set), Natural Earth, and a source-code link. It closes by
  swiping down anywhere on the sheet, tapping outside, Close, or Android back,
  and slides away while the backdrop fades.
- **Theme:** System, Light or Dark in Settings; the style, UI and veil follow it.
- **Android gestures:** MapLibre's zoom rate is set to 1.6 through a patch,
  because the React Native wrapper does not expose it.

Coverage rendering:

- The IDs of unlocked cells within one extra viewport on each side are loaded;
  the query recenters when a half-viewport margin no longer fits, or when the
  loaded area is more than twice as wide or tall as a fresh load (after zooming
  in), keeping the old geometry while loading. Antimeridian bounds are handled
  explicitly.
- The union of unlocked cells is cut out of an unvisited-area veil (a charcoal
  veil in light mode, translucent grey fog in dark mode). Internal cell edges
  are hidden; a subtle line marks the frontier. Enclosed unvisited areas stay
  veiled. Veil geometry is derived at render time, kept per display resolution
  for the currently loaded cells, and never persisted.
- Zoomed out, coverage is aggregated to H3 parents for display only: resolution
  11 at zoom 14 and above, one resolution coarser every two zoom levels, down to
  resolution 5 at zoom 2–4, with 0.15-zoom hysteresis. A coarse cell means at
  least one visited child.
- The visible query refreshes after ingestion and on app activation, so cells
  written in the background appear immediately.
- If tiles cannot be loaded, "Saved map unavailable" shows the failing step
  (open database, read tiles, draw tiles) and a scrubbed reason, and a
  `map-load-error` diagnostics event is recorded.

## Countries and globe

At zoom 7 and below the map fades in country borders and a tint for visited
countries. A country count opens a sheet with a rotatable globe and the visited
countries, their first visit and approximate explored percentage.

- **Data:** Natural Earth v5.1.2 1:10m countries (public domain), simplified to
  0.05°; countries under 5,000 km² keep full geometry. Grouped by sovereign
  state; Antarctica is excluded. Areas come from the unsimplified source. See
  `src/data/countries/README.md`.
- **Assignment:** by the center of each resolution-11 cell.
- **Coverage:** the unique resolution-4 parents of a country's cells, clipped to
  its borders, summed and divided by its area, capped at 100%. This is an
  estimate of broad explored regions, not precise ground coverage.
- **Background scan:** results are kept in `yonder-country-cache.db`: each
  country's first visit and each explored resolution-4 parent with its clipped
  area. The scan resumes from the last processed `rowid` of `unlocked_cells`
  (new cells always get a larger one), so after the first pass only new cells
  are processed. It works in slices of about 8 ms regardless of zoom, pauses
  while the app is in the background, and commits each 128-cell page
  atomically. Countries appear as soon as they are found; a percentage shows as
  calculating until all its parents have an area.
- **Cache transactions** run one at a time as `BEGIN IMMEDIATE` / `COMMIT` on
  the cache's own connection. Do not use Expo's exclusive transactions here:
  opening a connection per page broke reads on the main database connection
  with "file is not a database".
- **Rebuilds:** the cache starts over when the bundled boundaries change (a
  fingerprint of every country's ID and area), when the unlocked cells were
  replaced, and after every backup import. A generation number discards a page
  scanned across a reset.
- **Globe:** a separate orthographic view, because MapLibre Native has no globe
  projection. `scripts/prepare-globe.mjs` derives about 5,000 outline points
  from the bundled countries, plus Antarctica. Dragging rotates it; latitude is
  clamped at the poles. It reuses the country summary and makes no requests.

## Backups

- **Automatic:** a consistent `yonder-backup.db` snapshot made with SQLite's
  serialization API, saved in app storage at most every 15 minutes after
  ingestion and whenever the app goes to the background.
- **Export:** Settings saves a fresh snapshot to a folder chosen with the system
  picker. On Android the folder is a Storage Access Framework `content://` URI,
  so the file is created through the provider (`Directory.createFile`). If the
  name exists the provider picks a unique one, such as `yonder-backup (1).db`,
  which Settings reports. Provider documents are never overwritten in place,
  because some providers do not truncate. A partly written document is deleted.
- **Import:** accepts Yonder snapshots at schema version 3 and merges only
  unlocked cells. The snapshot is opened separately in memory, checked for
  integrity, and every cell is validated against H3 resolution 11 before one
  atomic merge. Merges run in batches of 500: one lookup, then one multi-row
  upsert of only new cells and cells whose visit window widens; only new cells
  derive their center. Overlaps keep the earliest first visit and latest last
  visit. Re-importing is idempotent and an unchanged backup writes nothing.
  Invalid backups leave local data unchanged.
- **Failures** report their step (export: choose folder, read database, create
  file, write file; import: read file, check file type, open backup, open Yonder
  database, check and add tiles) and a reason made of the native error code and
  message with URIs, paths and decimal numbers removed. Each failure is recorded
  as a `backup-error` diagnostics event.

## Diagnostics

An always-on log in `yonder-diagnostics.db` records process starts, app state
changes, permission and tracking state, background-task (re)registration, each
background batch (count, age, accuracy range, accepted and unlocked counts),
and task, update, ingestion, backup and map-load errors.

Events never contain coordinates, place names, cell IDs or raw records; details
are scalar values and coordinate-like keys are rejected. Writes are queued,
never throw and never block ingestion. Events older than seven days are pruned
and at most 5,000 are kept. Settings → Diagnostics shows the log and can clear
it or share it as text; nothing leaves the device unless the user shares it.

## Android releases

Signed APKs are published as GitHub releases for installers such as Obtainium.

- Merging a change to `main` that sets a new version in `app.json` and
  `package.json` makes CI tag the merge commit `v<version>` and build it. A
  version that is already tagged releases nothing. Pushing a tag by hand also
  builds a release.
- `vMAJOR.MINOR.PATCH-beta.N` builds a prerelease with the production package
  and key, so betas update the installed app in place and keep its data.
- `versionCode = (MAJOR * 1,000,000 + MINOR * 1,000 + PATCH) * 100 + SUFFIX`,
  where `SUFFIX` is N for `beta.N` (1–98) and 99 for stable. Android never
  installs a lower `versionCode`, so this scheme cannot be reverted.
- Every update must be signed by the same production key, supplied to CI through
  repository secrets and never committed. Releases contain code and assets only,
  never user data.

## Privacy and security

- Location history stays on the device. No telemetry or analytics.
- Never log coordinates, raw records, secrets or map-provider tokens.
- Never commit real coordinates, databases, exports or signing material; use
  synthetic routes in fixtures.
- Parameterized SQL only; imported fields are validated before persistence.
- `EXPO_PUBLIC_` variables are bundled into the app and must not hold secrets.

## Verification

- `npm run typecheck`, `npm run lint` and `npm test` (Vitest) cover domain and
  data logic, including real in-memory SQLite transactions, migrations,
  ingestion, viewport queries, backup import, country scanning and the H3 patch.
- `npm run qa:ios` drives an iOS Simulator with Maestro and a synthetic route
  through the operating system's location service, checks the app's actual
  database, and relaunches to verify persistence.
- Background collection can only be verified meaningfully on physical devices.

## Open decisions

- User-facing import of third-party location history, pending a real export.
- Offline basemap tiles (for example a zoom 0–6 world pack of roughly 120 MB).
- Encryption at rest and user-facing data reset.
- Manual editing of country visits.
- Self-hosting map tiles if OpenFreeMap's public instance (no SLA) becomes
  unreliable.
