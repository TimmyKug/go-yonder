import { File } from "expo-file-system";

import { atBackupStage } from "@/src/data/backup-failure";
import type { BackupImportResult } from "@/src/data/backup-import-repository";
import { getCountryCache } from "@/src/data/country-cache-database";
import { resetCountryCache } from "@/src/data/country-cache-repository";
import { getDatabase } from "@/src/data/database";
import { type GpxImportResult, importGpxText } from "@/src/data/gpx-import";
import { importYonderBackupBytes, isSqliteFile } from "@/src/data/import-yonder-backup";
import { recordDiagnostic } from "@/src/diagnostics/diagnostics";
import { looksLikeGpx } from "@/src/domain/gpx";

export type LocationFileImportResult =
  | ({ kind: "backup" } & BackupImportResult)
  | ({ kind: "gpx" } & GpxImportResult);

/** Imports a Yonder backup or a GPX file, recognised by its contents. */
export async function importLocationFile(
  onProgress?: (processedCount: number, totalCount: number) => void,
): Promise<LocationFileImportResult | null> {
  // The picker reports every failure, not only a cancellation, as canceled.
  const selection = await File.pickFileAsync({});
  if (selection.canceled) return null;
  const file = selection.result;
  const startedAtMs = Date.now();
  const bytes = await atBackupStage("read file", () => file.bytes());
  if (isSqliteFile(bytes)) {
    const result = await importYonderBackupBytes(bytes);
    recordDiagnostic("import-finished", {
      kind: "backup",
      durationMs: Date.now() - startedAtMs,
      pointCount: result.totalPointCount,
      addedPointCount: result.addedPointCount,
      addedTileCount: result.addedTileCount,
    });
    return { kind: "backup", ...result };
  }

  const text = await atBackupStage("read file", () => file.text());
  await atBackupStage("check file type", () => {
    if (!looksLikeGpx(text)) {
      throw new Error("Choose a Yonder backup (.db) or a GPX file.");
    }
  });
  const database = await atBackupStage("open Yonder database", getDatabase);
  const result = await atBackupStage("add GPS points", () =>
    importGpxText(text, { database, onProgress }));
  // Imported points can make existing visits earlier; rebuild the derived cache.
  await getCountryCache().then(resetCountryCache).catch(() => undefined);
  recordDiagnostic("import-finished", {
    kind: "gpx",
    durationMs: Date.now() - startedAtMs,
    pointCount: result.pointCount,
    addedPointCount: result.addedPointCount,
    addedTileCount: result.addedTileCount,
  });
  return { kind: "gpx", ...result };
}
