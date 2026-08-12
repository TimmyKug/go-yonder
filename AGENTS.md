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
- Do not assume a Bump export schema. Add an adapter only after inspecting a real export.
- Never log coordinates, raw imported records, secrets, or map-provider tokens.

## Coding conventions

- Use strict TypeScript and path aliases.
- Use kebab-case for non-route filenames.
- Prefer small domain functions with explicit inputs and outputs.
- Define background tasks at module scope, outside React components.
- Make ingestion idempotent; revisiting a cell and reprocessing an external record must not duplicate persisted data.

## Local development

The repository is currently in its documentation-only bootstrap state. Add and verify concrete install, development, test, lint, and build commands here when the application scaffold is committed.

## Change safety

- Never use `rm`. Use `trash <path>`. If `trash` is unavailable, stop and tell the user.
- Preserve user changes and avoid destructive Git operations.
- Do not commit credentials, signing material, private exports, generated native build directories, or personal location data.
- Use synthetic coordinates and routes in fixtures and automated tests.

## Commit guidance

- Never add `Co-authored-by` trailers to commits.
- Keep architecture/documentation decisions committed before implementation that depends on them.
- Run all applicable verified checks before committing implementation changes.
