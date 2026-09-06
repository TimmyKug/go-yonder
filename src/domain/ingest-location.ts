import {
  MAX_LIVE_HORIZONTAL_ACCURACY_M,
  TESSERA_H3_RESOLUTION,
} from "../config/tessera-config";

import type { HexGrid } from "./hex-grid";
import type {
  LocationSampleValidationError,
  NormalizedLocationSample,
} from "./location-sample";
import { validateNormalizedLocationSample } from "./location-sample";
import type { PreparedLocationObservation } from "./tessera";
import { assertValidResolution } from "./tessera";
import type { TesseraRepository } from "./tessera-repository";

export type RejectedLocationSample = {
  index: number;
  errors: readonly LocationSampleValidationError[];
};

export type IngestionResult = {
  receivedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  insertedSampleCount: number;
  duplicateSampleCount: number;
  insertedCellCount: number;
  updatedCellCount: number;
  rejections: readonly RejectedLocationSample[];
};

export type TesseraIngestionOptions = {
  resolution?: number;
  maxLiveHorizontalAccuracyM?: number;
};

export class TesseraIngestionService {
  private readonly resolution: number;
  private readonly maxLiveHorizontalAccuracyM: number;

  constructor(
    private readonly repository: TesseraRepository,
    private readonly hexGrid: HexGrid,
    options: TesseraIngestionOptions = {},
  ) {
    this.resolution = options.resolution ?? TESSERA_H3_RESOLUTION;
    this.maxLiveHorizontalAccuracyM =
      options.maxLiveHorizontalAccuracyM ?? MAX_LIVE_HORIZONTAL_ACCURACY_M;
    assertValidResolution(this.resolution);

    if (
      !Number.isFinite(this.maxLiveHorizontalAccuracyM) ||
      this.maxLiveHorizontalAccuracyM < 0
    ) {
      throw new RangeError(
        "maxLiveHorizontalAccuracyM must be non-negative and finite",
      );
    }
  }

  async ingest(
    samples: readonly NormalizedLocationSample[],
  ): Promise<IngestionResult> {
    const observations: PreparedLocationObservation[] = [];
    const rejections: RejectedLocationSample[] = [];

    samples.forEach((candidate, index) => {
      const validation = validateNormalizedLocationSample(candidate, {
        maxLiveHorizontalAccuracyM: this.maxLiveHorizontalAccuracyM,
      });

      if (!validation.accepted) {
        rejections.push({ index, errors: validation.errors });
        return;
      }

      const { sample } = validation;
      const cellId = this.hexGrid.cellForCoordinate(
        { latitude: sample.latitude, longitude: sample.longitude },
        this.resolution,
      );
      const center = this.hexGrid.centerForCell(cellId);

      observations.push({
        sample,
        cell: {
          cellId,
          resolution: this.resolution,
          centerLatitude: center.latitude,
          centerLongitude: center.longitude,
          firstSeenAtMs: sample.recordedAtMs,
          lastSeenAtMs: sample.recordedAtMs,
        },
      });
    });

    const persistence = await this.repository.ingestObservations(observations);

    return {
      receivedCount: samples.length,
      acceptedCount: observations.length,
      rejectedCount: rejections.length,
      insertedSampleCount: persistence.insertedSampleCount,
      duplicateSampleCount: persistence.duplicateSampleCount,
      insertedCellCount: persistence.insertedCellCount,
      updatedCellCount: persistence.updatedCellCount,
      rejections,
    };
  }
}
