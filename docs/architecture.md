# Architecture and implementation plan

- Status: Accepted and implemented for the core phase
- Date: 2026-08-12
- Last verified: 2026-08-18
- Scope: Core Yonder functionality

## Product scope

The product name is **Yonder**, with the tagline **Unveil your world.** Its
Android package and iOS bundle identifier are `com.timothykugler.yonder`.
Operating systems treat this
identity as a separate app from earlier development builds, and pre-release
on-device data is not migrated automatically. The considered alternatives and naming rationale are recorded in
[`docs/branding.md`](branding.md).

The application will provide:

- A full-screen, interactive map on iOS and Android.
- Foreground and background location collection, subject to operating-system permissions and lifecycle limits.
- Deterministic unlocking of geographic hexagonal cells as valid locations are observed.
- Durable, device-local persistence across app restarts.
- A source-neutral ingestion boundary so future location-history exports can be imported without rewriting the map or persistence layers.

This phase deliberately excludes animations, explored percentages, recaps, nights, leaderboards, accounts, backend synchronization, and third-party import formats.

## Technology decisions

### Application framework: Expo, React Native, and TypeScript

The project will use Expo with React Native, strict TypeScript, and Expo Router.

Reasons:

- Expo provides a cohesive location, background-task, SQLite, document-picker, and build toolchain.
- The relevant native capabilities can be configured through Expo config plugins.
- TypeScript has direct access to the official H3 JavaScript implementation.
- This project is greenfield, so no existing Dart or native platform investment needs to be preserved.

MapLibre and background location require native modules. Expo Go may be useful for pieces of the app, but development builds are the supported end-to-end test target.

Flutter remains a viable alternative, but it does not offer a material benefit for this scope. The map renderer is native in both approaches, while Expo offers a lower integration risk for the chosen H3 and location stack.

### Map renderer: MapLibre React Native

MapLibre Native will render the base map and unlocked-cell overlay.

- Unlocked cells are supplied as a batched GeoJSON source.
- Native fill and line layers render that source.
- The app will not mount one React component per hexagon.
- The official OpenStreetMap standard raster style remains a fallback rather
  than the default basemap.
- The map keeps a persistent attribution info control at the bottom-left edge,
  just above the system safe area. One tap expands the required linked
  `© OpenMapTiles` and `© OpenStreetMap contributors` credits inline over the
  map. Optional provider credit does not occupy permanent map space.
- Persistent controls use a stable map hierarchy: on-device saving status at
  top-left; in-app Settings at top-right; recenter at
  bottom-right; attribution at bottom-left. Actionable tracking warnings may
  temporarily occupy the lower map above those controls.
- The default basemap provider is OpenFreeMap using its subdued Positron light
  style and Dark style. Its public instance requires no registration or API
  key and explicitly supports MapLibre Native mobile apps.
- The app follows the operating-system light/dark preference and changes the
  complete map style plus its UI and reveal-overlay palette.
- Theme-specific style URL environment variables can replace either complete
  style without changing domain or map-overlay code.
- OpenFreeMap provides no uptime SLA. Because its production stack and styles
  are open source, self-hosting the same data/style architecture is the fallback
  if public-instance reliability becomes insufficient.

This keeps map interaction native and leaves the project independent of a proprietary map SDK. The installed MapLibre React Native 11 API, config plugin, and generated iOS/Android projects have been verified against Expo SDK 57's new architecture. iOS native builds have been exercised on both a simulator and a physical development device; Android native and cross-platform distribution checks remain required before distribution.

### Spatial index: H3

H3 is the canonical internal grid.

- `latLngToCell` maps an observation to a deterministic identifier.
- `cellToBoundary` produces the polygon rendered by MapLibre.
- The initial canonical resolution is **11**, whose average hexagon edge is approximately 28.7 metres and average area is approximately 2,150 square metres.
- Resolution is stored with persisted data and treated as a schema-level decision.

Resolution 11 is an initial balance between visible detail, ordinary GPS accuracy, storage growth, and background sampling frequency. A visual/device spike will validate it before real history is relied upon. Changing it later requires regenerating derived cells from retained normalized observations.

The exact Expo 57/Hermes compatibility spike found that `h3-js` 4.5.0 eagerly constructs an unused UTF-16LE `TextDecoder`, while Expo's native decoder accepts UTF-8 only. The app therefore pins 4.5.0 and applies a checked-in `patch-package` patch that removes only that unused initializer from the executable bundles. A regression test guards the patch and known H3 output. This keeps the official H3 implementation and does not change its grid behavior; the patch must be re-evaluated before upgrading H3 or Expo.

### Persistence: Expo SQLite

SQLite is the local source of truth. No backend is required.

- Enable write-ahead logging.
- Apply ordered, transactional schema migrations.
- Use prepared/parameterized statements and transactional batch upserts.
- Keep SQL inside the data layer.
- Store normalized observations as well as derived cells so grid rules can be replayed later.

Location data remains on the device unless the user explicitly requests a future export or synchronization feature.

Backups use SQLite's online serialization API to produce one consistent
`yonder-backup.db` snapshot. An app-private snapshot is refreshed at most
every 15 minutes after successful ingestion and whenever the foreground app
moves to the background. A user can also force a fresh export: the system
directory picker saves or replaces the snapshot in any writable Files provider
on iOS or Android, including a provider-managed synchronized folder. The live
WAL database is never exposed or copied directly, and the app does not upload
location data or retain access to the selected provider after export finishes.

### Location: Expo Location and Task Manager

`expo-location` supplies location readings and `expo-task-manager` hosts the background callback.

- Request foreground permission before explaining and requesting background permission.
- Define the background task at module scope.
- Use an Android foreground-service notification while background tracking is active.
- Prefer distance-driven updates around the size of the selected cells, with conservative deferred batching in the background.
- Route foreground and background samples through the same ingestion service.
- When an already-authorized app becomes active with background tracking registered, request one foreground fix to seed the current-position UI and camera; failure to obtain that convenience fix must not stop background collection.

The current tuning baseline is high location accuracy with a 20-metre distance
interval. Foreground tracking requests updates at most once per second;
background tracking requests them at most once every three seconds. These are
runtime configuration values, not persistence semantics, and will be adjusted
after device testing for accuracy and battery use.

Platform constraints will be communicated honestly:

- Users may deny precise or background permission.
- The operating system may defer or pause updates.
- Force-quitting the app can prevent continued collection, with behavior differing by platform and Android vendor.
- Background behavior must be tested with development/release builds on physical devices.

### Android distribution: signed GitHub releases

Android updates are distributed as APK assets on tagged GitHub releases so an
installer such as Obtainium can discover and install them. Release tags use the
form `vMAJOR.MINOR.PATCH`; CI embeds that semantic version and a monotonically
increasing Android `versionCode` into the APK before building it.

Every Yonder update must be signed by the same dedicated production key.
Signing material is supplied to CI through encrypted repository secrets and is
never committed. Because this repository is private, Obtainium must use a
fine-grained GitHub token restricted to read-only access to this repository.
Publishing an APK does not change the local-first data architecture: releases
contain application code and assets only, never the on-device database or an
export.

## System boundaries

```text
Live foreground GPS ─────┐
Live background GPS ─────┼──> LocationSource
Future import adapter ───┘          │
                                    ▼
                         NormalizedLocationSample
                                    │
                          validation / deduplication
                                    │
                                    ▼
                               HexGrid (H3)
                                    │
                                    ▼
                           CoverageRepository
                         ┌──────────┴──────────┐
                         ▼                     ▼
                 location_samples       unlocked_cells
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                         viewport-aware query
                                    │
                                    ▼
                        GeoJSON source + layers
```

Dependency direction is inward: route/UI code composes interfaces; domain logic knows neither Expo nor SQLite; adapters implement platform and persistence details.

## Repository structure

```text
app/
  _layout.tsx                    Router composition and providers
  index.tsx                      Thin map route
src/
  features/yonder/
    components/                  Map and permission UI
    hooks/                       Viewport and persisted-cell coordination
  domain/
    hex-grid.ts                  HexGrid contract and H3 implementation
    location-sample.ts           Normalized model and validation
    ingest-location.ts           Validation-to-persistence orchestration
    yonder.ts                    Shared geographic records
    yonder-repository.ts         Persistence contract
  data/
    database.ts                  Configured SQLite singleton
    migrations/                  Ordered schema migrations
    yonder-repository.ts         Transactional samples/cells access
    yonder-backup.ts             Consistent local backup snapshots
  location/
    background-location-task.ts  Module-scope task definition
    background-location-task.web.ts  Informational web no-op
    location-ingestion.ts        Expo-to-domain normalization
    location-service.ts          Permission and lifecycle orchestration
    location-state.ts            External state store for the UI
  import/
    import-adapter.ts            Future source-adapter contract
  config/
    yonder-config.ts             Persistence and H3 configuration
tests/
  support/                       Node SQLite adapter for real DB tests
docs/
  architecture.md                This decision record
patches/
  h3-js+4.5.0.patch              Expo native runtime compatibility patch
```

Expo Router's `app/` directory will contain routes and layouts only.

## Domain contracts

The normalized observation is independent of Expo and any import provider:

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
```

The future import contract yields normalized samples rather than touching the database:

```ts
interface ImportAdapter {
  readonly sourceType: string;
  canRead(file: ImportFile): Promise<boolean>;
  read(file: ImportFile): AsyncIterable<NormalizedLocationSample>;
}
```

Any provider-specific adapter is deferred until a real export is available.

## Persistence model

### `location_samples`

Stores validated observations for auditability and deterministic re-indexing.

| Column | Purpose |
| --- | --- |
| `id` | Internal integer primary key |
| `source` | Foreground, background, or import source |
| `source_record_id` | Optional stable external identifier |
| `recorded_at_ms` | UTC Unix epoch milliseconds |
| `latitude` / `longitude` | Normalized WGS84 coordinate |
| `horizontal_accuracy_m` | Accuracy when supplied |
| `import_batch_id` | Optional owning import batch |
| `fingerprint` | Deterministic deduplication key |

The fingerprint is unique. It is derived from stable normalized fields so replaying a background batch or re-importing an external record is idempotent.

### `unlocked_cells`

Stores the materialized coverage map.

| Column | Purpose |
| --- | --- |
| `cell_id` | H3 identifier |
| `resolution` | H3 resolution used to derive it |
| `center_latitude` / `center_longitude` | Fast viewport filtering |
| `first_seen_at_ms` | Earliest contributing observation |
| `last_seen_at_ms` | Latest contributing observation |

`(cell_id, resolution)` is the primary key. Revisits update the time range rather than create another cell.

### `import_batches`

Reserved for future import traceability and safe retries.

| Column | Purpose |
| --- | --- |
| `id` | Stable batch identifier |
| `source_type` | Adapter/provider name |
| `file_name` | Display name only, not an absolute path |
| `file_hash` | Prevents accidental duplicate imports |
| `parser_version` | Records the transformation rules used |
| `status` | Pending, running, completed, or failed |
| `created_at_ms` / `completed_at_ms` | Lifecycle timestamps |

The original import file will not be retained automatically because it may contain highly sensitive data.

## Ingestion and unlocking rules

For every candidate sample:

1. Validate finite WGS84 latitude/longitude values and a valid timestamp.
2. Apply source-specific accuracy policy. Live readings that are too imprecise are rejected rather than unlocking arbitrary nearby cells.
3. Calculate the deterministic sample fingerprint.
4. Convert the accepted coordinate to the canonical H3 cell.
5. Within one SQLite transaction, insert the sample if new and upsert the cell's first/last-seen range.
6. Notify the active map query after the transaction commits.

The initial live maximum horizontal-accuracy threshold is 50 metres. Rejected samples are not persisted as valid history.

To avoid fabricating travel, the first implementation will unlock the cell containing each accepted observation. Sampling is configured near the cell scale to produce natural continuity. It will not blindly draw a line between sparse points. If physical-device testing reveals small holes, a later rule may bridge only adjacent, tightly timed samples; that rule must be versioned and tested before it affects persisted cells.

## Map query and rendering

- The camera/viewport is converted to a geographic bounding box.
- SQLite preloads unlocked cells within one extra viewport width/height on each
  side. The query is recentered when a half-viewport margin no longer fits in
  the loaded bounds, retaining the previous geometry while loading. This buffer
  stays bounded to the current area and refreshes after ingestion or activation.
- Antimeridian-crossing bounds are handled explicitly.
- H3 boundaries are converted to GeoJSON longitude/latitude order.
- H3 cells remain the canonical persisted and queried coverage geometry. At
  render time, their union is cut out of the unvisited-area veil.
- Internal cell boundaries are visually suppressed. A subtle line around the
  union emphasizes the expanding explored frontier without making the H3
  implementation the product's visual identity.
- The union and veil geometry are derived in pure domain code and never
  persisted.
- Enclosed unvisited regions remain covered by the veil, including regions
  containing disconnected visited islands; surrounding a cell never unlocks it.
- Zoomed-out coverage is a display-only H3 parent aggregation. At zoom 14 and
  above show canonical resolution 11, resolution 10 spans zoom 13 to 14, and
  every two zoom levels thereafter selects the next coarser resolution, down
  to resolution 4. A coarse cell indicates
  at least one visited child, not complete exploration of that larger area.
  Zooming back in restores exact coverage, including unvisited holes. Persisted
  cells, statistics, and ingestion stay at resolution 11. This halves the
  smallest apparent hex size compared with switching at zoom 15. A 0.15-zoom
  hysteresis prevents scale flicker near thresholds. Aggregation uses already loaded cell
  IDs and runs only when coverage or the display resolution changes.
- Map updates are batched after committed ingestion rather than issued for every render.
- On app activation, the visible query refreshes so cells written by a background task appear immediately.
- A successfully persisted live sample clears a prior transient location-update or ingestion error; permission and tracking-start failures remain explicit until their own conditions change.

The light map uses a charcoal veil over unvisited areas. The dark map instead
uses a cool gray, translucent fog that lifts and softens unvisited ground while
leaving explored ground crisp and genuinely dark. In both themes, the union of
unlocked H3 cells is cut out of the veil. The explored map remains effectively
untinted; only its subtle frontier distinguishes it from the hidden-area veil.

## Country overview

At zoom 7 and below, the same map fades in neutral silver country boundaries
and a subtle visited-country tint. The explored hex veil remains visible above
the country fill. No mode switch, tab, or visited/unvisited legend is added.
A compact country count opens a native sheet listing visited countries, first
visit dates, and approximate uncovered percentages. The count includes all
saved coverage, independent of the viewport, and refreshes after location
ingestion, import, and app activation.

Natural Earth v5.1.2 1:10m country polygons are prepared into a single compact
offline dataset simplified to 0.05 degrees, which is roughly one screen pixel
at the country overview's closest zoom. The same geometry is reused for map
drawing, point assignment, and boundary clipping so opening the overview does
not parse a second high-detail world dataset. Countries under 5,000 square
kilometres retain their source geometry so microstates and small islands remain
discoverable; smaller countries take precedence where simplification closes an
enclave in a larger neighbour.
Countries are grouped by Natural Earth's sovereign identifier, so dependencies
count toward their sovereign country; Antarctica is excluded. Natural Earth's
boundary definitions apply. Country area denominators are calculated from the
unsimplified source during data preparation and retained in the compact data.
Visits are assigned from canonical resolution-11 cell centers. Country coverage
uses unique resolution-4 parent hexes, the largest display size, regardless of
the current zoom. Each visited country's parent hexes are clipped to its
boundaries before summing area. The denominator is the spherical area of the
bundled country's polygons. Percentages are cartographic estimates and are
capped at 100%. This intentionally summarizes broad explored regions rather
than precise ground coverage, as requested. This is a derived local summary with no
schema change, network reverse geocoding, or uploaded history. Saved cells are
read in pages and cached classifications are reused between refreshes.

Manual visit editing is deferred; this iteration derives visits from saved
coverage only. Country list and map use the same completed summary snapshot.

On Android, Yonder sets MapLibre Native's zoom rate to 1.6 so the one-finger
double-tap-and-drag gesture traverses the map faster. The React Native wrapper
does not expose the native setting, so the pinned package is patched during
postinstall. iOS keeps MapLibre's platform gesture rate because its native SDK
does not expose an equivalent setting.

## Permission and error states

The map remains usable when tracking is unavailable. Normal active tracking
does not show a persistent status card: the live location dot and compact
on-device indicator provide sufficient confirmation. A bottom overlay appears
only for actionable or unavailable tracking states:

- Location permission not requested.
- Foreground permission granted, background permission not granted.
- Approximate location only.
- System location services disabled.
- Tracking active.
- Recoverable location or persistence error.

Permission requests are initiated by a clear user action and accompanied by concise privacy copy. Android's background settings transition is explained before opening system settings.

## External-data portability strategy

Yonder does not assume that any external provider publishes raw GPS records,
reusable coverage cells, or a stable export schema. When requesting portable
data, ask for observed location-history records in a structured,
machine-readable format, including latitude, longitude, timestamp, horizontal
accuracy, and source where retained. Also request any cell identifiers,
grid/resolution metadata, boundaries, unlock timestamps, and a schema/data
dictionary.

Once a real archive exists:

1. Inspect it locally without committing or uploading it.
2. Document its schema and limitations with synthetic examples.
3. Implement a streaming adapter for the observed format.
4. Validate and fingerprint normalized samples.
5. Feed them through the same repository/H3 pipeline used by live GPS.
6. Record parser version and batch results for deterministic retries.

If a provider supplies coordinates and timestamps, import is straightforward.
If it supplies only proprietary cell identifiers, screenshots, or PDFs without
geographic/grid metadata, exact reconstruction may not be possible. The
application must never assume an external provider uses H3.

## Privacy and security

- Store location history locally by default.
- Do not add telemetry or analytics in the core implementation.
- Do not log location payloads in development or production.
- Never commit real coordinates, databases, exports, signing credentials, or provider tokens.
- Use parameterized SQL and validate imported fields before persistence.
- Use synthetic routes in fixtures.
- A future data deletion/export UI should be designed before wider distribution, but is outside this core phase.

## Verification strategy

### Automated checks

- Coordinate validation and normalization.
- Known coordinate-to-H3 fixtures at resolution 11.
- H3 boundary-to-GeoJSON ordering and polygon closure.
- Fingerprint stability and duplicate ingestion.
- Migration application and repeatability.
- Cell upsert first/last timestamp behavior.
- Viewport queries, including antimeridian bounds.
- Import-adapter contract using synthetic fixtures.
- Guard against regression of the H3/Expo native-runtime compatibility patch.
- Static TypeScript and lint checks.

Vitest owns the fast domain and data-layer suite. Native end-to-end coverage stays intentionally small: Maestro drives accessibility-visible journeys while `simctl` supplies synthetic GPS at the operating-system boundary. The harness queries the app's actual Expo SQLite database, captures screenshots, and relaunches the app to prove persisted cells are not lost. It does not add a test-only ingestion path.

### Native smoke tests

- Fresh install and foreground permission flow.
- Denied and approximate-only permission states.
- First location unlocks and persists a cell.
- Revisit does not duplicate the cell.
- Restart restores the same map.
- Walking route unlocks cells while open.
- Background/locked-screen route writes cells.
- Returning to foreground refreshes the overlay.
- Force-quit behavior is documented on both platforms.
- Map remains responsive with a generated large local cell set.

Physical-device tests are required for meaningful background-location verification.

### Current verification status

- TypeScript, lint, and 41 automated tests pass. The tests include real in-memory SQLite transactions rather than repository mocks.
- An iPhone 17 Pro simulator on iOS 26.4 passes the deterministic native foreground smoke test: a synthetic route unlocks at least three cells through Expo Location, MapLibre renders the overlay, and SQLite retains the cells across a terminate/relaunch cycle.
- A physical iPhone development build has launched and rendered the native map successfully. Background and locked-screen collection still need a dedicated physical-device route test.
- Production JS/Hermes bundles export successfully for iOS and Android; the informational web fallback also bundles successfully.
- An Android 16 emulator passes foreground and background location delivery with the persisted-job permission declared; a physical GrapheneOS device has also launched the standalone APK and recorded location samples.
- Expo Doctor passes 20 of 21 checks. Its only failure is host tooling: CocoaPods is not installed.
- Local iOS and Android native toolchains are configured on the host.
- `npm audit --omit=dev` reports 23 transitive Expo/React Native build-tool advisories (8 moderate, 15 high, 0 critical). npm's proposed forced fixes downgrade the compatible Expo/React Native stack, so they were not applied. Reassess these advisories with future SDK patches rather than overriding native-tool dependencies blindly.

## Delivery sequence

1. [x] Commit and push this architecture record before product implementation.
2. [x] Scaffold Expo with strict TypeScript, Router, linting, and tests.
3. [x] Run MapLibre configuration and exact H3/Hermes compatibility spikes.
4. [x] Implement domain contracts, migrations, repository, and ingestion tests.
5. [x] Implement permission handling and foreground/background location sources.
6. [x] Implement the full-screen map and viewport-aware GeoJSON overlay.
7. [ ] Complete native builds and physical-device smoke tests on both platforms.
8. [x] Commit and push the verified core implementation.

## Deferred decisions

- A hosted or self-hosted tile source for wider distribution or offline-region support; direct OpenStreetMap community tiles remain a deliberately small-scale choice.
- Guarded path interpolation, if device sampling creates visible holes.
- User-facing import flows and formats, pending a real export.
- Encryption-at-rest requirements for wider distribution.
- User-facing data export/reset controls.
- Animations, progress metrics, recaps, and social features.

## References

- [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)
- [Expo Task Manager](https://docs.expo.dev/versions/latest/sdk/task-manager/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [MapLibre React Native](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [H3 indexing functions](https://h3geo.org/docs/api/indexing/)
- [H3 resolution statistics](https://h3geo.org/docs/core-library/restable/)

## Backup import (0.2.2)

In-app Settings contains backup export, backup import, and a link to system
location permissions. Import accepts Yonder SQLite snapshots at schema version 3
and merges only unlocked cells, leaving local samples and import batches intact.
The snapshot is opened separately, checked for integrity, and all cells are
validated against H3 resolution 11 before a single atomic merge. Cell centers
are derived from H3 identifiers; overlapping cells retain the earliest first
visit and latest last visit. Reimporting is idempotent. Unsupported or invalid
backups leave local data unchanged. Returning to the map refreshes its coverage.
No backup data leaves the device through the import flow.
