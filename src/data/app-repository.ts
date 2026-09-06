import { h3HexGrid } from "../domain/hex-grid";
import type { IngestionResult } from "../domain/ingest-location";
import { TesseraIngestionService } from "../domain/ingest-location";
import type { NormalizedLocationSample } from "../domain/location-sample";
import type { TesseraRepository } from "../domain/tessera-repository";

import { getDatabase } from "./database";
import { refreshAutomaticTesseraBackupIfDue } from "./tessera-backup";
import { createTesseraRepository } from "./tessera-repository";

let repositoryPromise: Promise<TesseraRepository> | undefined;

export function getTesseraRepository(): Promise<TesseraRepository> {
  repositoryPromise ??= getDatabase()
    .then(createTesseraRepository)
    .catch((error: unknown) => {
      repositoryPromise = undefined;
      throw error;
    });
  return repositoryPromise;
}

export async function ingestNormalizedSamples(
  samples: readonly NormalizedLocationSample[],
): Promise<IngestionResult> {
  const repository = await getTesseraRepository();
  const service = new TesseraIngestionService(repository, h3HexGrid);
  const result = await service.ingest(samples);

  if (result.insertedSampleCount > 0) {
    await refreshAutomaticTesseraBackupIfDue().catch(() => undefined);
  }

  return result;
}

export type { TesseraRepository } from "../domain/tessera-repository";
export type { IngestionResult } from "../domain/ingest-location";
export type { NormalizedLocationSample } from "../domain/location-sample";
