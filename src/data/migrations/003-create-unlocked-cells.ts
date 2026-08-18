import type { DatabaseMigration } from "./migration";

export const createUnlockedCellsMigration: DatabaseMigration = {
  version: 3,
  name: "create-unlocked-cells",
  sql: `
    CREATE TABLE unlocked_cells (
      cell_id TEXT NOT NULL
        CHECK (length(cell_id) > 0),
      resolution INTEGER NOT NULL
        CHECK (typeof(resolution) = 'integer' AND resolution BETWEEN 0 AND 15),
      center_latitude REAL NOT NULL
        CHECK (center_latitude >= -90.0 AND center_latitude <= 90.0),
      center_longitude REAL NOT NULL
        CHECK (center_longitude >= -180.0 AND center_longitude <= 180.0),
      first_seen_at_ms INTEGER NOT NULL
        CHECK (typeof(first_seen_at_ms) = 'integer'),
      last_seen_at_ms INTEGER NOT NULL
        CHECK (typeof(last_seen_at_ms) = 'integer'),
      CHECK (first_seen_at_ms <= last_seen_at_ms),
      PRIMARY KEY (cell_id, resolution)
    );

    CREATE INDEX unlocked_cells_viewport_idx
      ON unlocked_cells (resolution, center_latitude, center_longitude);
  `,
};
