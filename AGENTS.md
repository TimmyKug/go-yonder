# AGENTS.md

## Project overview

This repository contains a local-first Expo application that records accepted device-location samples, converts them into H3 cells, persists them, and renders the unlocked cells over a native map.

The accepted product and architecture decisions live in `docs/architecture.md`. Update that document when a material decision changes.

## Architecture guardrails

- Keep Expo Router files in `app/`; put components, domain logic, data access, and services under `src/`.
- Keep the location pipeline source-neutral. Live GPS and future imports must enter through the same normalized-location contract.
- Access SQLite through repositories and migrations. UI components must not issue SQL.
- Treat the selected H3 resolution as versioned persisted data. Do not change it without a documented migration strategy.
- Keep location history on-device. Do not add analytics, cloud sync, or location uploads without explicit user approval.
- Do not assume an external export schema. Add an adapter only after inspecting a real export.
- Never log coordinates, raw imported records, secrets, or map-provider tokens.

## Coding conventions

- Use strict TypeScript and path aliases.
- Use kebab-case for non-route filenames.
- Prefer small domain functions with explicit inputs and outputs.
- Define background tasks at module scope, outside React components.
- Make ingestion idempotent; revisiting a cell and reprocessing an external record must not duplicate persisted data.

## Local development

- Install dependencies with `npm install`. The postinstall hook applies the required pinned `h3-js`/Expo runtime patch.
- Run `npm run typecheck`, `npm run lint`, and `npm test` before committing.
- Run native development builds with `npm run ios` or `npm run android`; Expo Go is not a supported end-to-end runtime for this project.
- Set `EXPO_PUBLIC_MAP_STYLE_URL` for a non-demo map style. Public Expo environment variables are bundled into the client and must not contain secrets.
- Re-run the Hermes compatibility spike and update the patch/tests before changing the exact `h3-js` version.

## Change safety

- Never use `rm`. Use `trash <path>`. If `trash` is unavailable, stop and tell the user.
- Preserve user changes and avoid destructive Git operations.
- Do not commit credentials, signing material, private exports, generated native build directories, or personal location data.
- Use synthetic coordinates and routes in fixtures and automated tests.

## Commit guidance

- Never add `Co-authored-by` trailers to commits.
- Keep architecture/documentation decisions committed before implementation that depends on them.
- Run all applicable verified checks before committing implementation changes.
