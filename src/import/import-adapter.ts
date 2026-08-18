import type { NormalizedLocationSample } from "../domain/location-sample";

/** A local file abstraction that does not assume JSON, CSV, GPX, or Bump's schema. */
export interface ImportFile {
  readonly name: string;
  readonly sizeBytes?: number;
  readChunks(): AsyncIterable<Uint8Array>;
}

export interface ImportAdapter {
  readonly sourceType: string;
  readonly parserVersion: string;
  canRead(file: ImportFile): Promise<boolean>;
  read(file: ImportFile): AsyncIterable<NormalizedLocationSample>;
}

export type ImportBatchStatus = "pending" | "running" | "completed" | "failed";
