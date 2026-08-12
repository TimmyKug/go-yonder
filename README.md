# Bump Clone

A private, local-first mobile scratch map. The app records where the device has been, maps accepted location samples to stable H3 cells, persists those cells on-device, and displays them over a native vector map.

The first release is intentionally narrow: map, location tracking, hex unlocking, and persistence. It does not include progress statistics, animations, social features, accounts, or cloud sync.

See [Architecture and implementation plan](docs/architecture.md) for the accepted technical decisions, boundaries, schema, and delivery phases.

> Location history is sensitive. Real exports and personal coordinates must never be committed to this repository.
