# Bump Clone

A private, local-first mobile scratch map. The app records where the device has been, maps accepted location samples to stable H3 cells, persists those cells on-device, and displays them over a native vector map.

The first release is intentionally narrow: map, location tracking, hex unlocking, and persistence. It does not include progress statistics, animations, social features, accounts, or cloud sync.

See [Architecture and implementation plan](docs/architecture.md) for the accepted technical decisions, boundaries, schema, and delivery phases.

> Location history is sensitive. Real exports and personal coordinates must never be committed to this repository.

## What works

- Foreground and background location permission flows.
- High-accuracy readings normalized through one source-neutral ingestion service.
- Resolution-11 H3 unlocking with a 50-metre live-accuracy threshold.
- Durable, idempotent SQLite storage of normalized observations and unlocked cells.
- A viewport-aware GeoJSON overlay on a native MapLibre map.
- A format-neutral adapter seam for a future Bump export.

There is deliberately no progress UI, animation, account, backend, or import screen yet.

## Local development

Requirements:

- Node.js 22.13 or newer and npm.
- Xcode/CocoaPods for iOS, or Android Studio/SDK for Android.
- A native development build. MapLibre and background location do not run in Expo Go.

Install and verify:

```sh
npm install
npm run typecheck
npm run lint
npm test
```

Run a native build:

```sh
npm run ios
npm run android
```

`npm install` applies the checked-in `h3-js` compatibility patch required by Expo 57's native runtime. Do not remove the postinstall step or loosen the exact H3 version without rerunning the Hermes compatibility test.

The app defaults to the official OpenStreetMap standard raster tiles, displays the required attribution, and identifies its native tile requests. This is appropriate for the current small private deployment, but the app does not preload or offer offline downloads from that service. Set `EXPO_PUBLIC_MAP_STYLE_URL` to replace the complete MapLibre style; any value with an `EXPO_PUBLIC_` prefix is bundled into the app and must not be treated as a secret.

The web route is an informational fallback only. The scratch map itself targets iOS and Android.

## Android updates with Obtainium

Android release APKs are published from tags named `vMAJOR.MINOR.PATCH`. Add
`https://github.com/TimmyKug/bump-clone` to Obtainium as a GitHub source.

The repository is private, so first add a fine-grained GitHub personal access
token in Obtainium's GitHub source settings. Restrict the token to this
repository with read-only access. Do not share or commit the token.

Maintainers must configure the `RELEASE_KEYSTORE_BASE64` GitHub Actions secret
with the Base64-encoded keystore used for the currently installed Android app.
Create and push a new semantic-version tag to publish an update, for example:

```sh
git tag v1.0.1
git push origin v1.0.1
```

Android only accepts an in-place update when its version code is higher and its
signing certificate matches the installed app. The release workflow enforces
the former and uses the repository secret for the latter.

## Native iOS QA

The repository includes a local iOS Simulator smoke test built around Maestro and CoreSimulator. It deliberately sends a synthetic route through the operating system's location service; it does not bypass the production ingestion pipeline.

Prerequisites:

- A bootable iOS Simulator and Xcode command-line tools.
- Maestro installed from its official Homebrew tap.
- Metro already running with `npx expo start --dev-client`.

```sh
brew tap mobile-dev-inc/tap
brew install mobile-dev-inc/tap/maestro
```

Run the complete native check with:

```sh
npm run qa:ios
```

The script resets only Scratch Map's simulator installation, builds the current native app, grants simulator location access, drives a synthetic central-Berlin route, verifies that at least three H3 cells reach SQLite, relaunches the app, and confirms no cells were lost. Screenshots and diagnostic logs are written under the ignored `.artifacts/ios-qa/` directory.

Set `IOS_QA_DEVICE_NAME` to select a different installed simulator. This loop validates foreground native integration and persistence; background/locked-screen behavior still requires a physical device.

## Data model

SQLite is the only source of truth. It stores accepted normalized observations, derived unlocked cells, and bookkeeping for future imports. Live readings and a future Bump adapter enter through the same validation, H3, and transactional upsert path. Re-importing or replaying an identical observation is safe.
