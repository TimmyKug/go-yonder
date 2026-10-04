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
- Visited countries and their regions with approximate explored percentages,
  and a globe view.
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
GPX import ──────────────┘          │
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
                        bounds, country coverage, globe projection, accuracy
                        area, GPX format
src/data/               SQLite databases, migrations, repositories, backups,
                        GPX export and import, bundled country and region data
src/location/           Permissions, foreground/background tracking, ingestion
src/countries/          Background country and region scan
src/tiles/              Background tile derivation for imported points
src/diagnostics/        On-device diagnostics recorder and report
src/features/           Screens, map view, hooks, appearance, globe
src/import/             Source-neutral import adapter contract
src/map/                Native map network configuration
tests/                  Vitest suite; tests/support has a Node SQLite adapter
patches/                h3-js, MapLibre and Expo Location patches applied on postinstall
scripts/                Country/region/globe data preparation and iOS QA
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

Live GPS and GPX import enter through the same normalized contract. GPX is a
published standard; provider-specific formats (for example location-history
exports) get an adapter only after inspecting a real export. Never assume an
external provider uses H3.

## Persistence

The main database `yonder.db` runs in WAL mode with a 5 s busy timeout and
ordered, transactional migrations. Its schema version is 3. Backups depend on
that version, so any change needs a documented migration and import strategy.

| Table | Purpose |
| --- | --- |
| `location_samples` | Validated observations: source, optional source record ID, `recorded_at_ms`, WGS84 coordinate, accuracy, optional import batch, and a unique `fingerprint` that makes replays and re-imports idempotent. |
| `unlocked_cells` | Coverage derived from `location_samples`, which are the source of truth. Primary key `(cell_id, resolution)`; stores the cell center for viewport filtering and `first_seen_at_ms` / `last_seen_at_ms`. Revisits widen the time range. |
| `import_batches` | Reserved for future import traceability: source type, display file name, file hash, parser version, status, timestamps. Original import files are never retained. |

Separate SQLite files keep derived and diagnostic data out of backups and leave
the backup schema unchanged:

- `yonder-diagnostics.db`: the diagnostics log.
- `yonder-country-cache.db`: the rebuildable country and region summary.
- Expo SQLite's key-value store: the appearance preference, the live accuracy
  limit, the folder backup settings and the tile derivation cursor. They are
  read synchronously, so background tasks apply the current choice.

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
- On Android, Task Manager restores the registered background task after a
  reboot or app update. `patches/expo-location+57.0.18.patch` starts the
  foreground service from that boot or package-replaced broadcast when
  background location is granted, so tracking resumes without opening the app;
  a test guards the patch. Devices that block apps from starting at boot, and
  apps the user force-stopped, still wait for the app to be opened.
- On Android, when the app becomes active with background tracking registered,
  the task is registered again: Android restores tasks after other process
  restarts without starting the foreground service, and re-registering
  restarts it.
- An already-authorized app requests one foreground fix on activation to seed
  the map; failing to get it never stops background collection.

For each sample:

1. Validate finite WGS84 coordinates and a valid timestamp.
2. Reject live readings less accurate than the chosen limit: **25, 50 or
   100 m** (default 50 m), set in Settings. They never unlock cells and are not
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

## Countries, regions and globe

At zoom 7 and below the map fades in country borders and tints visited
countries whole. From about zoom 4 closer in, thin region borders appear inside
visited countries and visited regions get a stronger tint on top. A country count opens a
sheet with a rotatable globe and the visited countries, their first visit,
approximate explored percentage and "N of M regions". Tapping a country lists
its visited regions with their own first visit and percentage.

- **Data:** Natural Earth v5.1.2 1:10m countries (public domain), simplified to
  0.05°; countries under 5,000 km² keep full geometry. Grouped by sovereign
  state; Antarctica is excluded. Areas come from the unsimplified source. See
  `src/data/countries/README.md`.
- **Region data:** Natural Earth v5.1.2 1:10m admin-1 states and provinces
  (public domain), bundled (about 5.7 MB, 4,594 regions) so no request reveals
  where the user is. Simplified to 0.02°; regions under 1,000 km² to 0.002°.
  Each region belongs to a country by its sovereign code. Natural Earth's
  first-level divisions differ between countries (German states, French
  départements, British districts). See `src/data/regions/README.md`.
- **Assignment:** by the center of each resolution-11 cell. A cell's region
  counts only if it belongs to the cell's country; the two border sets are
  simplified separately.
- **Coverage:** the unique resolution-4 parents of a country's cells, clipped to
  its borders, summed and divided by its area, capped at 100%. Regions use
  resolution-6 parents (about 36 km²) the same way. This is an estimate of
  broad explored areas, not precise ground coverage.
- **Background scan:** results are kept in `yonder-country-cache.db` (schema
  version 2): each country's and region's first visit and each explored parent
  with its clipped area. Country areas are computed before region areas. The scan resumes from the last processed `rowid` of `unlocked_cells`
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
  fingerprint of every country's and region's ID and area), when the unlocked cells were
  replaced, and after every backup import. A generation number discards a page
  scanned across a reset.
- **Globe:** a separate orthographic view, because MapLibre Native has no globe
  projection. `scripts/prepare-globe.mjs` derives about 5,000 outline points
  from the bundled countries, plus Antarctica. Dragging rotates it; latitude is
  clamped at the poles. It reuses the country summary and makes no requests.
  Each frame draws all visible land as two SVG paths, unvisited and visited,
  rather than one per country, and drag steps are coalesced to one redraw per
  animation frame.

## Backups

GPX is the only user-facing backup format: it holds every sample, which is
everything tiles are derived from.

- **Internal snapshot:** a consistent `yonder-backup.db` snapshot made with
  SQLite's serialization API, saved in app storage at most every 15 minutes
  after ingestion and whenever the app goes to the background. It is not shown
  to users.
- **Export:** Settings → Export saves every stored sample, oldest first, as one
  GPX 1.1 track (`yonder-points.gpx`) to a folder chosen with the system
  picker. Coordinates and accuracy are written as the shortest decimal that
  reads back as the same number (never exponent notation), with UTC times, the
  accuracy in a `yonder:accuracy` extension, the sample source in
  `yonder:source`, and a new segment after gaps of more than an hour, so a
  round trip restores identical samples and fingerprints. On Android the folder
  is a Storage Access Framework `content://` URI, so the file is created
  through the provider (`Directory.createFile`). If the name exists the
  provider picks a unique one, such as `yonder-points (1).gpx`, which Settings
  reports. A partly written document is deleted.
- **Folder backup (Android):** Settings → Automatic backup keeps permission to
  a folder the user picks and replaces `yonder-points.gpx` there every hour,
  6 hours, day (default) or week. It runs after
  ingestion that stored new samples (including in the background location task)
  and when the app goes to the background, once the interval has passed since
  the last success; a failure is retried at most hourly. Replacing deletes the
  previous document and creates a new one, because provider documents are
  never overwritten in place. The last success, or the last failure's step and
  reason, is shown in Settings and recorded as a `folder-backup` diagnostics
  event. A folder that syncs to a cloud service copies the history there, which
  Settings states; the app itself never uploads.
- **Import:** GPS points are the source of truth. Settings → Import recognises
  a file by its contents (GPX, or a `.db` backup from earlier versions) and
  stores only its points; tiles stored in a backup are ignored. Tiles on a
  device that have no points behind them (from tile-only imports in earlier
  versions) stay on that device but are not exported. Points are validated
  without the live accuracy limit (they were accepted when recorded), get a
  freshly computed fingerprint, and are inserted 120 per statement after one
  fingerprint lookup. Points that fail validation are skipped and counted.
  Each finished import records its duration and counts as an
  `import-finished` diagnostics event. Settings says that tiles for imported
  points appear gradually.
- **Background tile derivation:** imports leave tiles to `src/tiles`, which
  derives them in steps of 2,000 samples after a cursor (the highest sample ID
  covered by tiles, kept in the key-value store). Each step computes the
  resolution-11 cells, skipping the H3 call for a repeated position, and merges
  them 500 per statement in one short transaction, adding new cells and
  widening the visit window of existing ones; only new cells derive their
  center. The cursor moves only after a step commits, so an interruption
  repeats an idempotent step. The first cursor is the newest sample at the
  time, because live ingestion unlocks its own tiles immediately. It runs at
  launch, after an import and when the app returns to the foreground, pauses in
  the background, refreshes the visible tiles at most once a second, shows
  "Mapping N%" in the status pill, then rebuilds the country cache if
  tiles changed and records a `tiles-derived` diagnostics event.
- **Backup import** (earlier versions' `.db` exports) accepts Yonder snapshots at schema version 3 that contain a
  `location_samples` table. The snapshot is opened separately in memory,
  checked for integrity and read in pages of 1,000 by row ID. Source, time,
  coordinates, accuracy and external record ID are restored; an import-batch
  reference is cleared because it is local to the original device. All points
  are written in one transaction, so a failure changes nothing, and
  re-importing an unchanged backup writes nothing. Snapshots without points
  are rejected.
- **GPX import** reads track, route and waypoint points from any app with a
  tolerant scanner (namespace prefixes, either attribute order or quote style,
  self-closing points; times without a zone are UTC). Points without a time are
  skipped, because a visit needs one. Points keep a `yonder:source` when present
  and otherwise become `external-import` samples,
  written in chunks of 5,000 that each commit on their own, with progress
  shown. A point already stored at the same second within about
  10 cm, from any source, is skipped, so re-importing a file or Yonder's own
  export adds nothing. An interrupted import keeps the chunks already
  committed.
- **Failures** report their step (export: choose folder, read GPS points,
  create file, write file; folder backup: open folder, read GPS points, write
  file; import: read file, check file type,
  open backup, open Yonder database, add GPS points) and a
  reason made of the native error code and message with URIs, paths and
  decimal numbers removed. Each failure is recorded as a `backup-error`
  diagnostics event.

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

- The `CI` workflow's `Checks` job runs typecheck, lint and tests on every pull
  request and on `main`, and checks the version: `app.json`, `package.json` and
  `package-lock.json` agree, the `versionCode` follows the formula below, a
  changed version has a higher `versionCode` than the base branch and is not
  tagged yet. A ruleset on `main` requires this check, so a release is never
  tagged for a change that fails it. Version rules live in
  `.github/scripts/release-version.mjs`, shared by the check and the build.

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
  ingestion, viewport queries, backup and GPX import, GPX export, folder
  backups, country scanning and the H3 patch.
- `npm run qa:ios` drives an iOS Simulator with Maestro and a synthetic route
  through the operating system's location service, checks the app's actual
  database, and relaunches to verify persistence.
- Background collection can only be verified meaningfully on physical devices.

## Open decisions

- Import of provider location-history formats other than GPX, pending a real
  export.
- Folder backups on iOS, which need security-scoped bookmarks.
- Offline basemap tiles (for example a zoom 0–6 world pack of roughly 120 MB).
- Encryption at rest and user-facing data reset.
- Manual editing of country visits.
- Self-hosting map tiles if OpenFreeMap's public instance (no SLA) becomes
  unreliable.
