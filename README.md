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

The app defaults to MapLibre's public demo style for development. Set `EXPO_PUBLIC_MAP_STYLE_URL` to an attributed production style before distribution; any value with an `EXPO_PUBLIC_` prefix is bundled into the app and must not be treated as a secret.

The web route is an informational fallback only. The scratch map itself targets iOS and Android.

## Data model

SQLite is the only source of truth. It stores accepted normalized observations, derived unlocked cells, and bookkeeping for future imports. Live readings and a future Bump adapter enter through the same validation, H3, and transactional upsert path. Re-importing or replaying an identical observation is safe.
