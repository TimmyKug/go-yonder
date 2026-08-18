import { h3HexGrid } from "../domain/hex-grid";
import type { IngestionResult } from "../domain/ingest-location";
import { ScratchMapIngestionService } from "../domain/ingest-location";
import type { NormalizedLocationSample } from "../domain/location-sample";
import type { ScratchMapRepository } from "../domain/scratch-map-repository";

import { getDatabase } from "./database";
import { createScratchMapRepository } from "./scratch-map-repository";

let repositoryPromise: Promise<ScratchMapRepository> | undefined;

export function getScratchMapRepository(): Promise<ScratchMapRepository> {
  repositoryPromise ??= getDatabase()
    .then(createScratchMapRepository)
    .catch((error: unknown) => {
      repositoryPromise = undefined;
      throw error;
    });
  return repositoryPromise;
}

export async function ingestNormalizedSamples(
  samples: readonly NormalizedLocationSample[],
): Promise<IngestionResult> {
  const repository = await getScratchMapRepository();
  const service = new ScratchMapIngestionService(repository, h3HexGrid);
  return service.ingest(samples);
}

export type { ScratchMapRepository } from "../domain/scratch-map-repository";
export type { IngestionResult } from "../domain/ingest-location";
export type { NormalizedLocationSample } from "../domain/location-sample";
