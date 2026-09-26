import { Directory } from "expo-file-system";

import { formatGpx, type GpxPoint } from "../domain/gpx";

import { atBackupStage } from "./backup-failure";
import { getDatabase } from "./database";
import { createDocument, type WrittenDocument } from "./document-files";
import { readAllSamplePoints } from "./location-sample-repository";

export const YONDER_GPX_FILE_NAME = "yonder-points.gpx";
export const GPX_MIME_TYPE = "application/gpx+xml";

export type GpxExportResult = {
  fileName: string;
  pointCount: number;
};

type GpxExportDependencies = {
  createFile: (directory: Directory) => WrittenDocument;
  pickDirectory: () => Promise<Directory>;
  readPoints: () => Promise<GpxPoint[]>;
};

export const defaultGpxExportDependencies: GpxExportDependencies = {
  createFile: (directory) => createDocument(directory, YONDER_GPX_FILE_NAME, GPX_MIME_TYPE),
  pickDirectory: () => Directory.pickDirectoryAsync(),
  readPoints: readStoredGpxPoints,
};

export async function readStoredGpxPoints(): Promise<GpxPoint[]> {
  return readAllSamplePoints(await getDatabase());
}

/** Saves every stored GPS point as a GPX track to a folder the user picks. */
export async function exportGpx(
  dependencies: GpxExportDependencies = defaultGpxExportDependencies,
): Promise<GpxExportResult> {
  const directory = await atBackupStage("choose folder", dependencies.pickDirectory);
  const points = await atBackupStage("read GPS points", dependencies.readPoints);
  const file = await atBackupStage("create file", () => dependencies.createFile(directory));
  await atBackupStage("write file", () => file.write(formatGpx(points)));
  return { fileName: file.name, pointCount: points.length };
}
