import { cellToLatLng, getResolution, isValidCell } from "h3-js";

import { YONDER_H3_RESOLUTION } from "@/src/config/yonder-config";
import type { SqlDatabase, SqlExecutor, SqlValue } from "@/src/data/sql-database";
import { validateNormalizedLocationSample } from "@/src/domain/location-sample";

// Each statement is several native round trips on a device, so cells and
// samples are merged in batches. 120 samples use 960 bound parameters, which
// also fits older SQLite builds with a 999-parameter limit.
const MERGE_BATCH_SIZE = 120;
const SAMPLE_BATCH_SIZE = 120;

type BackupCell = {
  cell_id: string;
  resolution: number;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
};

type ExistingCell = {
  cell_id: string;
  center_latitude: number;
  center_longitude: number;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
};

type BackupSample = {
  id: number;
  source: string;
  source_record_id: string | null;
  recorded_at_ms: number;
  latitude: number;
  longitude: number;
  horizontal_accuracy_m: number | null;
  import_batch_id: string | null;
  fingerprint: string;
};

type PreparedSampleRow = [string, string | null, number, number, number,
  number | null, null, string];

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** A snapshot without a primary key could repeat a cell; keep its widest visit window. */
function mergeDuplicateCells(cells: readonly BackupCell[]): BackupCell[] {
  const merged = new Map<string, BackupCell>();
  for (const cell of cells) {
    const previous = merged.get(cell.cell_id);
    merged.set(cell.cell_id, previous ? {
      ...cell,
      first_seen_at_ms: Math.min(previous.first_seen_at_ms, cell.first_seen_at_ms),
      last_seen_at_ms: Math.max(previous.last_seen_at_ms, cell.last_seen_at_ms),
    } : cell);
  }
  return [...merged.values()];
}

function validateBackupSample(row: BackupSample): PreparedSampleRow {
  if (!Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.recorded_at_ms)) {
    throw new Error("This backup contains invalid location samples.");
  }
  const date = new Date(row.recorded_at_ms);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("This backup contains invalid location samples.");
  }
  const validated = validateNormalizedLocationSample({
    source: row.source,
    sourceRecordId: row.source_record_id ?? undefined,
    recordedAt: date.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    horizontalAccuracyM: row.horizontal_accuracy_m ?? undefined,
    importBatchId: row.import_batch_id ?? undefined,
  }, {});
  if (!validated.accepted || validated.sample.fingerprint !== row.fingerprint) {
    throw new Error("This backup contains invalid location samples.");
  }

  const sample = validated.sample;
  // An import batch ID belongs to the source device. The observation's stable
  // fingerprint is independent of it and safely deduplicates across devices.
  return [sample.source, sample.sourceRecordId ?? null, sample.recordedAtMs,
    sample.latitude, sample.longitude, sample.horizontalAccuracyM ?? null,
    null, sample.fingerprint];
}

/** Reads a separate snapshot; never replaces the live database. */
export async function mergeBackupUnlocks(source: SqlExecutor, target: SqlDatabase) {
  await source.execute("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON");
  const version = await source.first<{ user_version: number }>("PRAGMA user_version");
  if (version?.user_version !== 3) {
    throw new Error("Unsupported backup version. Choose a Yonder backup from a compatible release.");
  }
  const integrity = await source.first<{ integrity_check: string }>("PRAGMA integrity_check");
  if (integrity?.integrity_check !== "ok") {
    throw new Error("This backup is damaged.");
  }
  const table = await source.first<{ type: string }>(
    "SELECT type FROM sqlite_schema WHERE name = 'unlocked_cells'",
  );
  if (table?.type !== "table") throw new Error("This is not a Yonder backup.");
  const samplesTable = await source.first<{ type: string }>(
    "SELECT type FROM sqlite_schema WHERE name = 'location_samples'",
  );
  if (samplesTable !== null && samplesTable.type !== "table") {
    throw new Error("This backup contains invalid location samples.");
  }
  const cells = await source.all<BackupCell>(
    "SELECT cell_id, resolution, first_seen_at_ms, last_seen_at_ms FROM unlocked_cells",
  );
  // Validate the entire snapshot before writing any local data.
  for (const cell of cells) {
    if (
      typeof cell.cell_id !== "string" || !/^[0-9a-f]{15}$/.test(cell.cell_id) || !isValidCell(cell.cell_id) ||
      cell.resolution !== YONDER_H3_RESOLUTION ||
      getResolution(cell.cell_id) !== cell.resolution ||
      !Number.isSafeInteger(cell.first_seen_at_ms) ||
      !Number.isSafeInteger(cell.last_seen_at_ms) ||
      cell.first_seen_at_ms > cell.last_seen_at_ms
    ) throw new Error("This backup contains invalid or unsupported tiles.");
  }
  const uniqueCells = mergeDuplicateCells(cells);
  return target.withExclusiveTransaction(async (transaction) => {
    let addedCount = 0;
    let addedSampleCount = 0;
    let totalSampleCount = 0;
    for (let start = 0; start < uniqueCells.length; start += MERGE_BATCH_SIZE) {
      const batch = uniqueCells.slice(start, start + MERGE_BATCH_SIZE);
      const existing = new Map((await transaction.all<ExistingCell>(
        `SELECT cell_id, center_latitude, center_longitude, first_seen_at_ms, last_seen_at_ms
         FROM unlocked_cells WHERE resolution = ? AND cell_id IN (${placeholders(batch.length)})`,
        [YONDER_H3_RESOLUTION, ...batch.map((cell) => cell.cell_id)],
      )).map((row) => [row.cell_id, row]));

      // Only new cells and cells whose visit window widens need a write, and
      // only new cells need their center derived.
      const rows: SqlValue[][] = [];
      for (const cell of batch) {
        const local = existing.get(cell.cell_id);
        if (!local) {
          const [latitude, longitude] = cellToLatLng(cell.cell_id);
          rows.push([cell.cell_id, cell.resolution, latitude, longitude,
            cell.first_seen_at_ms, cell.last_seen_at_ms]);
          addedCount += 1;
        } else if (cell.first_seen_at_ms < local.first_seen_at_ms ||
          cell.last_seen_at_ms > local.last_seen_at_ms) {
          rows.push([cell.cell_id, cell.resolution, local.center_latitude, local.center_longitude,
            cell.first_seen_at_ms, cell.last_seen_at_ms]);
        }
      }
      if (rows.length === 0) continue;

      await transaction.run(`
        INSERT INTO unlocked_cells (cell_id, resolution, center_latitude,
          center_longitude, first_seen_at_ms, last_seen_at_ms)
        VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
        ON CONFLICT (cell_id, resolution) DO UPDATE SET
          first_seen_at_ms = MIN(first_seen_at_ms, excluded.first_seen_at_ms),
          last_seen_at_ms = MAX(last_seen_at_ms, excluded.last_seen_at_ms)
      `, rows.flat());
    }

    if (samplesTable !== null) {
      let cursor = -Number.MAX_SAFE_INTEGER;
      const expected = await source.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM location_samples",
      );
      while (true) {
        const samples = await source.all<BackupSample>(`
          SELECT id, source, source_record_id, recorded_at_ms, latitude, longitude,
            horizontal_accuracy_m, import_batch_id, fingerprint
          FROM location_samples WHERE id > ? ORDER BY id LIMIT ?
        `, [cursor, SAMPLE_BATCH_SIZE]);
        if (samples.length === 0) break;

        const validated = samples.map(validateBackupSample);
        if (samples[0]!.id <= cursor) {
          throw new Error("This backup contains invalid location samples.");
        }
        cursor = samples.at(-1)!.id;
        totalSampleCount += samples.length;

        const fingerprints = validated.map((row) => row[7]);
        const existing = new Set((await transaction.all<{ fingerprint: string }>(
          `SELECT fingerprint FROM location_samples WHERE fingerprint IN (${placeholders(fingerprints.length)})`,
          fingerprints,
        )).map((row) => row.fingerprint));
        const newRows = validated.filter((row) => !existing.has(row[7]));
        if (newRows.length === 0) continue;

        const inserted = await transaction.run(`
          INSERT INTO location_samples (source, source_record_id, recorded_at_ms,
            latitude, longitude, horizontal_accuracy_m, import_batch_id, fingerprint)
          VALUES ${newRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
          ON CONFLICT (fingerprint) DO NOTHING
        `, newRows.flat());
        addedSampleCount += inserted.changes;
      }
      if (expected === null || !Number.isSafeInteger(expected.count) ||
        expected.count !== totalSampleCount) {
        throw new Error("This backup contains invalid location samples.");
      }
    }
    return { addedCount, totalCount: cells.length, addedSampleCount, totalSampleCount };
  });
}
