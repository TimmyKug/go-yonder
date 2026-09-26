import { h3HexGrid } from "../domain/hex-grid";
import type { IngestionResult } from "../domain/ingest-location";
import { YonderIngestionService } from "../domain/ingest-location";
import type { NormalizedLocationSample } from "../domain/location-sample";
import type { YonderRepository } from "../domain/yonder-repository";

import { getDatabase } from "./database";
import { runFolderBackupIfDue } from "./folder-backup";
import { refreshAutomaticYonderBackupIfDue } from "./yonder-backup";
import { createYonderRepository } from "./yonder-repository";

let repositoryPromise: Promise<YonderRepository> | undefined;

export function getYonderRepository(): Promise<YonderRepository> {
  repositoryPromise ??= getDatabase()
    .then(createYonderRepository)
    .catch((error: unknown) => {
      repositoryPromise = undefined;
      throw error;
    });
  return repositoryPromise;
}

export async function ingestNormalizedSamples(
  samples: readonly NormalizedLocationSample[],
  maxLiveHorizontalAccuracyM?: number,
): Promise<IngestionResult> {
  const repository = await getYonderRepository();
  const service = new YonderIngestionService(repository, h3HexGrid, {
    maxLiveHorizontalAccuracyM,
  });
  const result = await service.ingest(samples);

  if (result.insertedSampleCount > 0) {
    await refreshAutomaticYonderBackupIfDue().catch(() => undefined);
    // Runs in the background location task too, so it happens while tracking.
    await runFolderBackupIfDue().catch(() => undefined);
  }

  return result;
}

export type { YonderRepository } from "../domain/yonder-repository";
export type { IngestionResult } from "../domain/ingest-location";
export type { NormalizedLocationSample } from "../domain/location-sample";
