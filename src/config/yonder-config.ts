export const YONDER_H3_RESOLUTION = 11;

/** Accuracy limits a user can choose for live readings to unlock tiles. */
export const LIVE_ACCURACY_OPTIONS_M = [25, 50, 100] as const;
export type LiveAccuracyOptionM = (typeof LIVE_ACCURACY_OPTIONS_M)[number];

export const DEFAULT_MAX_LIVE_HORIZONTAL_ACCURACY_M: LiveAccuracyOptionM = 50;

export const YONDER_DATABASE_NAME = "yonder.db";

export const yonderConfig = Object.freeze({
  h3Resolution: YONDER_H3_RESOLUTION,
  maxLiveHorizontalAccuracyM: DEFAULT_MAX_LIVE_HORIZONTAL_ACCURACY_M,
  databaseName: YONDER_DATABASE_NAME,
});
