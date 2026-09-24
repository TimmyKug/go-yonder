import type {
  DiagnosticDetail,
  DiagnosticEvent,
  DiagnosticEventKind,
} from "../domain/diagnostic-event";

import type { DatabaseMigration } from "./migrations";
import type { SqlDatabase } from "./sql-database";

export const DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DIAGNOSTICS_MAX_EVENTS = 5_000;

export const DIAGNOSTICS_MIGRATIONS: readonly DatabaseMigration[] =
  Object.freeze([
    {
      version: 1,
      name: "create-diagnostic-events",
      sql: `
        CREATE TABLE diagnostic_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at_ms INTEGER NOT NULL
            CHECK (typeof(recorded_at_ms) = 'integer'),
          process_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (length(kind) > 0),
          detail TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX diagnostic_events_recorded_at_idx
          ON diagnostic_events (recorded_at_ms);
      `,
    },
  ]);

export type DiagnosticsRepository = {
  record(event: DiagnosticEvent): Promise<void>;
  listNewest(limit: number): Promise<DiagnosticEvent[]>;
  prune(nowMs: number): Promise<void>;
  clear(): Promise<void>;
};

type DiagnosticEventRow = {
  recorded_at_ms: number;
  process_id: string;
  kind: string;
  detail: string;
};

export function createDiagnosticsRepository(
  database: SqlDatabase,
): DiagnosticsRepository {
  return {
    async record(event) {
      await database.run(
        `INSERT INTO diagnostic_events (recorded_at_ms, process_id, kind, detail)
         VALUES (?, ?, ?, ?)`,
        [
          Math.round(event.recordedAtMs),
          event.processId,
          event.kind,
          JSON.stringify(event.detail),
        ],
      );
    },

    async listNewest(limit) {
      const rows = await database.all<DiagnosticEventRow>(
        `SELECT recorded_at_ms, process_id, kind, detail
         FROM diagnostic_events
         ORDER BY recorded_at_ms DESC, id DESC
         LIMIT ?`,
        [limit],
      );
      return rows.map(toEvent);
    },

    async prune(nowMs) {
      await database.run(
        "DELETE FROM diagnostic_events WHERE recorded_at_ms < ?",
        [Math.round(nowMs - DIAGNOSTICS_RETENTION_MS)],
      );
      await database.run(
        `DELETE FROM diagnostic_events
         WHERE id NOT IN (
           SELECT id FROM diagnostic_events
           ORDER BY recorded_at_ms DESC, id DESC
           LIMIT ?
         )`,
        [DIAGNOSTICS_MAX_EVENTS],
      );
    },

    async clear() {
      await database.run("DELETE FROM diagnostic_events");
    },
  };
}

function toEvent(row: DiagnosticEventRow): DiagnosticEvent {
  return Object.freeze({
    recordedAtMs: row.recorded_at_ms,
    processId: row.process_id,
    kind: row.kind as DiagnosticEventKind,
    detail: parseDetail(row.detail),
  });
}

function parseDetail(text: string): DiagnosticDetail {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as DiagnosticDetail)
      : {};
  } catch {
    return {};
  }
}
