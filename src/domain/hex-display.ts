import { cellToParent, getResolution } from "h3-js";

import { YONDER_H3_RESOLUTION } from "../config/yonder-config";

const MIN_DISPLAY_RESOLUTION = 4;
const DETAIL_ZOOM = 15;
const ZOOM_STEP = 2;
const HYSTERESIS = 0.15;

export function displayResolutionForZoom(zoom: number, current?: number): number {
  if (!Number.isFinite(zoom)) return current ?? YONDER_H3_RESOLUTION;
  if (current !== undefined) {
    const lower = DETAIL_ZOOM - (YONDER_H3_RESOLUTION - current) * ZOOM_STEP;
    const upper = lower + ZOOM_STEP;
    if (
      (current === MIN_DISPLAY_RESOLUTION || zoom >= lower - HYSTERESIS) &&
      (current === YONDER_H3_RESOLUTION || zoom < upper + HYSTERESIS)
    ) return current;
  }
  return Math.max(
    MIN_DISPLAY_RESOLUTION,
    Math.min(YONDER_H3_RESOLUTION,
      YONDER_H3_RESOLUTION + Math.floor((zoom - DETAIL_ZOOM) / ZOOM_STEP)),
  );
}

export function cellIdsAtDisplayResolution(
  cellIds: readonly string[],
  resolution: number,
): string[] {
  if (!Number.isInteger(resolution) || resolution < MIN_DISPLAY_RESOLUTION || resolution > YONDER_H3_RESOLUTION) {
    throw new RangeError("display resolution must be an integer between 4 and 11");
  }
  const parents = new Set<string>();
  for (const cellId of cellIds) {
    if (getResolution(cellId) !== YONDER_H3_RESOLUTION) {
      throw new Error("display coverage requires canonical resolution-11 cells");
    }
    parents.add(resolution === YONDER_H3_RESOLUTION ? cellId : cellToParent(cellId, resolution));
  }
  return [...parents];
}
