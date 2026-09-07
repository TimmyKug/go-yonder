import { YONDER_H3_RESOLUTION } from "../config/yonder-config";
import type {
  GeographicBounds,
  PreparedLocationObservation,
  UnlockedCell,
} from "../domain/yonder";
import {
  assertValidGeographicBounds,
  assertValidResolution,
} from "../domain/yonder";
import type {
  PersistenceIngestionResult,
  YonderRepository,
} from "../domain/yonder-repository";

import type { SqlDatabase, SqlExecutor } from "./sql-database";

type UnlockedCellRow = {
  cell_id: string;
  resolution: number;
  center_latitude: number;
  center_longitude: number;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
};

const INSERT_SAMPLE_SQL = `
  INSERT INTO location_samples (
    source,
    source_record_id,
    recorded_at_ms,
    latitude,
    longitude,
    horizontal_accuracy_m,
    import_batch_id,
    fingerprint
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (fingerprint) DO NOTHING
`;

const INSERT_CELL_SQL = `
  INSERT INTO unlocked_cells (
    cell_id,
    resolution,
    center_latitude,
    center_longitude,
    first_seen_at_ms,
    last_seen_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (cell_id, resolution) DO NOTHING
`;

const UPDATE_CELL_TIME_RANGE_SQL = `
  UPDATE unlocked_cells
  SET
    first_seen_at_ms = MIN(first_seen_at_ms, ?),
    last_seen_at_ms = MAX(last_seen_at_ms, ?)
  WHERE cell_id = ? AND resolution = ?
`;

async function insertObservation(
  transaction: SqlExecutor,
  observation: PreparedLocationObservation,
): Promise<"duplicate" | "inserted-cell" | "updated-cell"> {
  const { sample, cell } = observation;
  const sampleInsert = await transaction.run(INSERT_SAMPLE_SQL, [
    sample.source,
    sample.sourceRecordId ?? null,
    sample.recordedAtMs,
    sample.latitude,
    sample.longitude,
    sample.horizontalAccuracyM ?? null,
    sample.importBatchId ?? null,
    sample.fingerprint,
  ]);

  if (sampleInsert.changes === 0) {
    return "duplicate";
  }
  if (sampleInsert.changes !== 1) {
    throw new Error("inserting a location sample changed an unexpected row count");
  }

  const cellInsert = await transaction.run(INSERT_CELL_SQL, [
    cell.cellId,
    cell.resolution,
    cell.centerLatitude,
    cell.centerLongitude,
    sample.recordedAtMs,
    sample.recordedAtMs,
  ]);

  if (cellInsert.changes === 1) {
    return "inserted-cell";
  }
  if (cellInsert.changes !== 0) {
    throw new Error("inserting an unlocked cell changed an unexpected row count");
  }

  const cellUpdate = await transaction.run(UPDATE_CELL_TIME_RANGE_SQL, [
    sample.recordedAtMs,
    sample.recordedAtMs,
    cell.cellId,
    cell.resolution,
  ]);
  if (cellUpdate.changes !== 1) {
    throw new Error("updating an unlocked cell changed an unexpected row count");
  }
  return "updated-cell";
}

function toUnlockedCell(row: UnlockedCellRow): UnlockedCell {
  return {
    cellId: row.cell_id,
    resolution: row.resolution,
    centerLatitude: row.center_latitude,
    centerLongitude: row.center_longitude,
    firstSeenAtMs: row.first_seen_at_ms,
    lastSeenAtMs: row.last_seen_at_ms,
  };
}

export class SqliteYonderRepository implements YonderRepository {
  constructor(private readonly database: SqlDatabase) {}

  async ingestObservations(
    observations: readonly PreparedLocationObservation[],
  ): Promise<PersistenceIngestionResult> {
    if (observations.length === 0) {
      return {
        processedCount: 0,
        insertedSampleCount: 0,
        duplicateSampleCount: 0,
        insertedCellCount: 0,
        updatedCellCount: 0,
      };
    }

    return this.database.withExclusiveTransaction(async (transaction) => {
      let insertedSampleCount = 0;
      let duplicateSampleCount = 0;
      let insertedCellCount = 0;
      let updatedCellCount = 0;

      for (const observation of observations) {
        const result = await insertObservation(transaction, observation);
        if (result === "duplicate") {
          duplicateSampleCount += 1;
          continue;
        }

        insertedSampleCount += 1;
        if (result === "inserted-cell") {
          insertedCellCount += 1;
        } else {
          updatedCellCount += 1;
        }
      }

      return {
        processedCount: observations.length,
        insertedSampleCount,
        duplicateSampleCount,
        insertedCellCount,
        updatedCellCount,
      };
    });
  }

  async listUnlockedCells(
    bounds: GeographicBounds,
    resolution = YONDER_H3_RESOLUTION,
  ): Promise<UnlockedCell[]> {
    assertValidGeographicBounds(bounds);
    assertValidResolution(resolution);

    const longitudePredicate =
      bounds.west <= bounds.east
        ? "center_longitude BETWEEN ? AND ?"
        : "(center_longitude >= ? OR center_longitude <= ?)";

    const rows = await this.database.all<UnlockedCellRow>(
      `
        SELECT
          cell_id,
          resolution,
          center_latitude,
          center_longitude,
          first_seen_at_ms,
          last_seen_at_ms
        FROM unlocked_cells
        WHERE
          resolution = ?
          AND center_latitude BETWEEN ? AND ?
          AND ${longitudePredicate}
        ORDER BY cell_id
      `,
      [
        resolution,
        bounds.south,
        bounds.north,
        bounds.west,
        bounds.east,
      ],
    );

    return rows.map(toUnlockedCell);
  }
}

export function createYonderRepository(
  database: SqlDatabase,
): YonderRepository {
  return new SqliteYonderRepository(database);
}
