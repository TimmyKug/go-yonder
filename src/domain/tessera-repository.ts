import type {
  GeographicBounds,
  PreparedLocationObservation,
  UnlockedCell,
} from "./tessera";

export type PersistenceIngestionResult = {
  processedCount: number;
  insertedSampleCount: number;
  duplicateSampleCount: number;
  insertedCellCount: number;
  updatedCellCount: number;
};

export interface TesseraRepository {
  ingestObservations(
    observations: readonly PreparedLocationObservation[],
  ): Promise<PersistenceIngestionResult>;

  listUnlockedCells(
    bounds: GeographicBounds,
    resolution?: number,
  ): Promise<UnlockedCell[]>;
}
