# Yonder

**Unveil your world.**

A private, local-first coverage map for iOS and Android. Yonder records where
the device has been, unlocks the H3 hexagons it passes through, and reveals them
on a native map. Everything stays on the device: no accounts, backend,
analytics, or cloud sync.

<a href="https://www.buymeacoffee.com/timmykug"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-green.png" alt="Buy me a coffee" height="44"></a>

> Location history is sensitive. Never commit real exports, databases, or
> personal coordinates to this repository.

## Features

- Foreground and background tracking; readings less accurate than 50 m never
  unlock tiles.
- Resolution-11 H3 coverage revealed through a veil over unvisited areas, with
  coarser hexes when zoomed out.
- A weak-GPS indicator that shows an inaccurate fix and its accuracy radius.
- Visited countries with approximate explored percentages, and a globe view.
- An offline fallback map with bundled country borders.
- Backup export and idempotent backup import in Settings.
- An on-device diagnostics log that never contains locations.

How it works is described in [docs/architecture.md](docs/architecture.md).

## Development

Requirements: Node.js 22.13 or newer, and Xcode for iOS or the Android SDK for
Android. MapLibre and background location need a native development build; Expo
Go is not supported.

```sh
npm install        # also applies the h3-js and MapLibre patches
npm run typecheck
npm run lint
npm test
npm run ios        # or: npm run android
```

The basemap is OpenFreeMap (Positron and Dark), which needs no API key.
`EXPO_PUBLIC_MAP_STYLE_LIGHT_URL` and `EXPO_PUBLIC_MAP_STYLE_DARK_URL` replace
either style. `EXPO_PUBLIC_` values are bundled into the app, so never put
secrets in them.

The web target is an informational page only.

### iOS simulator QA

With Metro running (`npx expo start --dev-client`), Xcode command-line tools and
[Maestro](https://maestro.mobile.dev/) installed:

```sh
npm run qa:ios
```

It reinstalls Yonder on a simulator (`IOS_QA_DEVICE_NAME`, default
`iPhone 17 Pro`), drives a synthetic route through the OS location service,
checks that at least three cells reach SQLite, relaunches, and confirms they
persist. Output goes to the ignored `.artifacts/ios-qa/`. Background tracking
still needs a physical device.

## Android releases and Obtainium

Add `https://github.com/TimmyKug/go-yonder` to Obtainium as a GitHub source.
Turn on **Include prereleases** to also receive beta builds; betas update the
installed app in place and keep its data.

To release, merge a change to `main` that sets the new version in `app.json`
(`expo.version` and `expo.android.versionCode`) and `package.json`:

- `X.Y.Z` publishes a release, `X.Y.Z-beta.N` a prerelease.
- `versionCode = (X * 1,000,000 + Y * 1,000 + Z) * 100 + N`, with `N = 99` for
  a stable release. Android only installs a higher `versionCode` signed with the
  same key.

The **Release on merge** workflow tags the merge commit and builds a signed
APK. It needs the `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`,
`RELEASE_KEY_ALIAS` and `RELEASE_KEY_PASSWORD` repository secrets.

## License

[MIT](LICENSE). Country boundaries come from
[Natural Earth](https://www.naturalearthdata.com/), which is in the public
domain.
