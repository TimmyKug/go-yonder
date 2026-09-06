import { describe, expect, it } from "vitest";

import type { NormalizedLocationSample } from "../src/domain/location-sample";
import type {
  ImportAdapter,
  ImportFile,
} from "../src/import/import-adapter";

class SyntheticFile implements ImportFile {
  readonly name = "synthetic.export";
  readonly sizeBytes = 3;

  async *readChunks(): AsyncIterable<Uint8Array> {
    yield new Uint8Array([1, 2, 3]);
  }
}

class SyntheticAdapter implements ImportAdapter {
  readonly sourceType = "synthetic";
  readonly parserVersion = "test-v1";

  async canRead(file: ImportFile): Promise<boolean> {
    return file.name.endsWith(".export");
  }

  async *read(_file: ImportFile): AsyncIterable<NormalizedLocationSample> {
    yield {
      source: "external-import",
      sourceRecordId: "synthetic-record",
      recordedAt: "2026-01-01T00:00:00.000Z",
      latitude: 10,
      longitude: 20,
    };
  }
}

describe("ImportAdapter contract", () => {
  it("streams source-neutral normalized samples without prescribing a file format", async () => {
    const file = new SyntheticFile();
    const adapter = new SyntheticAdapter();

    expect(await adapter.canRead(file)).toBe(true);
    const records: NormalizedLocationSample[] = [];
    for await (const record of adapter.read(file)) {
      records.push(record);
    }

    expect(records).toEqual([
      expect.objectContaining({
        source: "external-import",
        sourceRecordId: "synthetic-record",
      }),
    ]);
  });
});
