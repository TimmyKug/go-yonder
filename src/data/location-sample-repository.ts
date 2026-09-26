import type { GpxPoint } from "../domain/gpx";

import type { SqlExecutor } from "./sql-database";

type SampleRow = {
  recorded_at_ms: number;
  latitude: number;
  longitude: number;
  horizontal_accuracy_m: number | null;
};

/** Every stored GPS point, oldest first. */
export async function readAllSamplePoints(database: SqlExecutor): Promise<GpxPoint[]> {
  const rows = await database.all<SampleRow>(`
    SELECT recorded_at_ms, latitude, longitude, horizontal_accuracy_m
    FROM location_samples
    ORDER BY recorded_at_ms, id
  `);
  return rows.map((row) => ({
    latitude: row.latitude,
    longitude: row.longitude,
    recordedAtMs: row.recorded_at_ms,
    ...(row.horizontal_accuracy_m === null ? {} : { horizontalAccuracyM: row.horizontal_accuracy_m }),
  }));
}

// GPX stores seven decimal places, about a centimetre.
const SAME_PLACE_DEGREES = 1e-6;

/**
 * Tells which points are already stored at the same time and place from any
 * source, so importing Yonder's own GPX does not duplicate its live samples.
 */
export async function createStoredPointMatcher(
  database: SqlExecutor,
  fromMs: number,
  toMs: number,
): Promise<(point: { recordedAtMs: number; latitude: number; longitude: number }) => boolean> {
  const rows = await database.all<SampleRow>(
    `
      SELECT recorded_at_ms, latitude, longitude, horizontal_accuracy_m
      FROM location_samples
      WHERE recorded_at_ms BETWEEN ? AND ?
    `,
    [fromMs, toMs],
  );
  const byTime = new Map<number, SampleRow[]>();
  for (const row of rows) {
    const list = byTime.get(row.recorded_at_ms);
    if (list) list.push(row);
    else byTime.set(row.recorded_at_ms, [row]);
  }
  return (point) =>
    byTime.get(point.recordedAtMs)?.some(
      (row) =>
        Math.abs(row.latitude - point.latitude) < SAME_PLACE_DEGREES &&
        Math.abs(row.longitude - point.longitude) < SAME_PLACE_DEGREES,
    ) ?? false;
}
