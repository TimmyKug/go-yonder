# Architecture and implementation plan

- Status: Accepted
- Date: 2026-08-12
- Scope: Core scratch-map functionality

## Product scope

The application will provide:

- A full-screen, interactive map on iOS and Android.
- Foreground and background location collection, subject to operating-system permissions and lifecycle limits.
- Deterministic unlocking of geographic hexagonal cells as valid locations are observed.
- Durable, device-local persistence across app restarts.
- A source-neutral ingestion boundary so a future Bump data export can be imported without rewriting the map or persistence layers.

This phase deliberately excludes animations, explored percentages, recaps, nights, leaderboards, accounts, backend synchronization, and a Bump import user interface.

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
- The base-map style URL is configuration, not a domain dependency.
- MapLibre demo tiles may be used during development only; a production tile/style provider is a separate deployment decision.

This keeps map interaction native and leaves the project independent of a proprietary map SDK. A development spike must verify the current MapLibre React Native release against the selected Expo SDK and new architecture before deeper implementation.

### Spatial index: H3

H3 is the canonical internal grid.

- `latLngToCell` maps an observation to a deterministic identifier.
- `cellToBoundary` produces the polygon rendered by MapLibre.
- The initial canonical resolution is **11**, whose average hexagon edge is approximately 28.7 metres and average area is approximately 2,150 square metres.
- Resolution is stored with persisted data and treated as a schema-level decision.

Resolution 11 is an initial balance between visible detail, ordinary GPS accuracy, storage growth, and background sampling frequency. A visual/device spike will validate it before real history is relied upon. Changing it later requires regenerating derived cells from retained normalized observations.

The implementation will verify `h3-js` under React Native's Hermes runtime before adopting it fully. If the official JavaScript package is incompatible with the selected runtime, the fallback is a small native H3 binding behind the same `HexGrid` interface—not a change to the persisted/domain contracts.

### Persistence: Expo SQLite

SQLite is the local source of truth. No backend is required.

- Enable write-ahead logging.
- Apply ordered, transactional schema migrations.
- Use prepared/parameterized statements and transactional batch upserts.
- Keep SQL inside the data layer.
- Store normalized observations as well as derived cells so grid rules can be replayed later.

Location data remains on the device unless the user explicitly requests a future export or synchronization feature.

### Location: Expo Location and Task Manager

`expo-location` supplies location readings and `expo-task-manager` hosts the background callback.

- Request foreground permission before explaining and requesting background permission.
- Define the background task at module scope.
- Use an Android foreground-service notification while background tracking is active.
- Prefer distance-driven updates around the size of the selected cells, with conservative deferred batching in the background.
- Route foreground and background samples through the same ingestion service.

The first tuning baseline is high location accuracy with an approximately 20-25 metre distance interval. These are runtime configuration values, not persistence semantics, and will be adjusted after device testing for accuracy and battery use.

Platform constraints will be communicated honestly:

- Users may deny precise or background permission.
- The operating system may defer or pause updates.
- Force-quitting the app can prevent continued collection, with behavior differing by platform and Android vendor.
- Background behavior must be tested with development/release builds on physical devices.

## System boundaries

```text
Live foreground GPS ─────┐
Live background GPS ─────┼──> LocationSource
Future Bump adapter ─────┘          │
                                    ▼
                         NormalizedLocationSample
                                    │
                          validation / deduplication
                                    │
                                    ▼
                               HexGrid (H3)
                                    │
                                    ▼
                          ScratchMapRepository
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

## Planned repository structure

```text
app/
  _layout.tsx                    Router composition and providers
  index.tsx                      Thin map route
src/
  features/scratch-map/
    components/                  Map and permission UI
    hooks/                       Viewport and persisted-cell coordination
  domain/
    hex-grid.ts                  HexGrid contract and H3 implementation
    location-sample.ts           Normalized model and validation
    scratch-map.ts               Ingestion rules
  data/
    database.ts                  SQLite opening and migration runner
    migrations/                  Ordered schema migrations
    scratch-map-repository.ts    Transactional samples/cells access
  location/
    background-location-task.ts  Module-scope task definition
    expo-location-source.ts      Foreground/background adapter
    location-service.ts          Permission and lifecycle orchestration
  import/
    import-adapter.ts            Future source-adapter contract
  config/
    scratch-map-config.ts        H3 and tracking configuration
  testing/
    fixtures/                    Synthetic location routes only
docs/
  architecture.md                This decision record
```

Expo Router's `app/` directory will contain routes and layouts only.

## Domain contracts

The normalized observation is independent of Expo and Bump:

```ts
type LocationSource = "live-foreground" | "live-background" | "bump-import";

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

The actual Bump adapter is deferred until a real export is available.

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

Stores the materialized scratch map.

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
- SQLite returns unlocked cells whose stored centers intersect that box plus a small padding margin.
- Antimeridian-crossing bounds are handled explicitly.
- H3 boundaries are converted to GeoJSON longitude/latitude order.
- A single GeoJSON source feeds a translucent fill and subtle outline layer.
- Map updates are batched after committed ingestion rather than issued for every render.
- On app activation, the visible query refreshes so cells written by a background task appear immediately.

The first visual treatment highlights unlocked cells over a subdued base map. A true inverse scratch mask and visual effects belong to the later polish phase.

## Permission and error states

The map remains usable when tracking is unavailable. A compact overlay presents actionable states:

- Location permission not requested.
- Foreground permission granted, background permission not granted.
- Approximate location only.
- System location services disabled.
- Tracking active.
- Recoverable location or persistence error.

Permission requests are initiated by a clear user action and accompanied by concise privacy copy. Android's background settings transition is explained before opening system settings.

## Bump portability strategy

amo's published privacy policy provides mechanisms to request access/portable data, but Bump publishes no export schema and does not promise raw GPS records or reusable Scratch Map cells.

When making a request, ask for all raw and observed location-history records in a structured, machine-readable format, including latitude, longitude, timestamp, horizontal accuracy, and source where retained. Also request Scratch Map cell identifiers, grid/resolution metadata, boundaries, unlock timestamps, and a schema/data dictionary.

Once a real archive exists:

1. Inspect it locally without committing or uploading it.
2. Document its schema and limitations with synthetic examples.
3. Implement a streaming adapter for the observed format.
4. Validate and fingerprint normalized samples.
5. Feed them through the same repository/H3 pipeline used by live GPS.
6. Record parser version and batch results for deterministic retries.

If Bump supplies coordinates and timestamps, import is straightforward. If it supplies only proprietary cell identifiers, screenshots, or PDFs without geographic/grid metadata, exact reconstruction may not be possible. The application must never assume Bump itself uses H3.

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
- Static TypeScript and lint checks.

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

## Delivery sequence

1. Commit and push this architecture record before product implementation.
2. Scaffold Expo with strict TypeScript, Router, linting, and tests.
3. Run a native compatibility spike for MapLibre and H3/Hermes.
4. Implement domain contracts, migrations, repository, and ingestion tests.
5. Implement permission handling and foreground/background location sources.
6. Implement the full-screen map and viewport-aware GeoJSON overlay.
7. Exercise synthetic routes, run checks, and smoke-test development builds.
8. Commit and push the verified core implementation.

## Deferred decisions

- Production map tile/style provider and its operating cost.
- Guarded path interpolation, if device sampling creates visible holes.
- User-facing Bump import flow and formats, pending a real export.
- Encryption-at-rest requirements for wider distribution.
- User-facing data export/reset controls.
- Animations, progress metrics, recaps, and social features.

## References

- [Bump Scratch Map help](https://help.bumpmaps.com/en/articles/11604738-scratch-map)
- [amo privacy policy](https://amo.co/privacy-policy/)
- [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)
- [Expo Task Manager](https://docs.expo.dev/versions/latest/sdk/task-manager/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [MapLibre React Native](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/)
- [H3 indexing functions](https://h3geo.org/docs/api/indexing/)
- [H3 resolution statistics](https://h3geo.org/docs/core-library/restable/)
