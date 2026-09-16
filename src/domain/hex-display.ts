import { cellToParent, getResolution } from "h3-js";

import { YONDER_H3_RESOLUTION } from "../config/yonder-config";

const MIN_DISPLAY_RESOLUTION = 5;
const MAX_DISPLAY_RESOLUTION = YONDER_H3_RESOLUTION;
const HYSTERESIS = 0.15;
export const MIN_MAP_ZOOM = 2;
export const MAX_MAP_ZOOM = 20;

const SCALE_LEVELS = [
  { resolution: MAX_DISPLAY_RESOLUTION, minZoom: 14 },
  { resolution: 10, minZoom: 12 },
  { resolution: 9, minZoom: 10 },
  { resolution: 8, minZoom: 8 },
  { resolution: 7, minZoom: 6 },
  { resolution: 6, minZoom: 4 },
  { resolution: MIN_DISPLAY_RESOLUTION, minZoom: MIN_MAP_ZOOM },
] as const;

export function isValidMapZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= MIN_MAP_ZOOM && zoom <= MAX_MAP_ZOOM;
}

export function displayResolutionForZoom(zoom: number, current?: number): number {
  if (!Number.isFinite(zoom)) return current ?? MAX_DISPLAY_RESOLUTION;
  if (current !== undefined) {
    const index = SCALE_LEVELS.findIndex(({ resolution }) => resolution === current);
    const lower = SCALE_LEVELS[index]?.minZoom ?? MIN_MAP_ZOOM;
    const upper = SCALE_LEVELS[index - 1]?.minZoom ?? MAX_MAP_ZOOM;
    if (
      (current === MIN_DISPLAY_RESOLUTION || zoom >= lower - HYSTERESIS) &&
      (current === MAX_DISPLAY_RESOLUTION || zoom < upper + HYSTERESIS)
    ) return current;
  }
  return SCALE_LEVELS.find(({ minZoom }) => zoom >= minZoom)?.resolution ?? MIN_DISPLAY_RESOLUTION;
}

export function cellIdsAtDisplayResolution(
  cellIds: readonly string[],
  resolution: number,
): string[] {
  if (!Number.isInteger(resolution) || resolution < MIN_DISPLAY_RESOLUTION || resolution > MAX_DISPLAY_RESOLUTION) {
    throw new RangeError("display resolution must be an integer between 5 and 11");
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
