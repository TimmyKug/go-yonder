import type { DatabaseMigration } from "./migration";

export const createLocationSamplesMigration: DatabaseMigration = {
  version: 2,
  name: "create-location-samples",
  sql: `
    CREATE TABLE location_samples (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL
        CHECK (source IN ('live-foreground', 'live-background', 'external-import')),
      source_record_id TEXT
        CHECK (
          source_record_id IS NULL OR
          length(source_record_id) BETWEEN 1 AND 4096
        ),
      recorded_at_ms INTEGER NOT NULL
        CHECK (typeof(recorded_at_ms) = 'integer'),
      latitude REAL NOT NULL
        CHECK (latitude >= -90.0 AND latitude <= 90.0),
      longitude REAL NOT NULL
        CHECK (longitude >= -180.0 AND longitude <= 180.0),
      horizontal_accuracy_m REAL
        CHECK (horizontal_accuracy_m IS NULL OR horizontal_accuracy_m >= 0.0),
      import_batch_id TEXT REFERENCES import_batches(id) ON DELETE RESTRICT,
      fingerprint TEXT NOT NULL UNIQUE
        CHECK (length(fingerprint) > 0)
    );

    CREATE INDEX location_samples_recorded_at_idx
      ON location_samples (recorded_at_ms);

    CREATE INDEX location_samples_source_record_idx
      ON location_samples (source, source_record_id)
      WHERE source_record_id IS NOT NULL;

    CREATE INDEX location_samples_import_batch_idx
      ON location_samples (import_batch_id)
      WHERE import_batch_id IS NOT NULL;
  `,
};
