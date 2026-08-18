import type { DatabaseMigration } from "./migration";

export const createImportBatchesMigration: DatabaseMigration = {
  version: 1,
  name: "create-import-batches",
  sql: `
    CREATE TABLE import_batches (
      id TEXT PRIMARY KEY NOT NULL
        CHECK (length(id) BETWEEN 1 AND 4096),
      source_type TEXT NOT NULL
        CHECK (length(source_type) BETWEEN 1 AND 255),
      file_name TEXT NOT NULL
        CHECK (length(file_name) BETWEEN 1 AND 1024),
      file_hash TEXT NOT NULL
        CHECK (length(file_hash) BETWEEN 1 AND 1024),
      parser_version TEXT NOT NULL
        CHECK (length(parser_version) BETWEEN 1 AND 255),
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer'),
      completed_at_ms INTEGER
        CHECK (completed_at_ms IS NULL OR typeof(completed_at_ms) = 'integer'),
      CHECK (completed_at_ms IS NULL OR completed_at_ms >= created_at_ms),
      UNIQUE (source_type, file_hash, parser_version)
    );

    CREATE INDEX import_batches_status_created_at_idx
      ON import_batches (status, created_at_ms);
  `,
};
