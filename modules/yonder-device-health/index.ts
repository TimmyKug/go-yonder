import { requireOptionalNativeModule } from "expo";

export type NativePowerState = {
  ignoringBatteryOptimizations: boolean;
  backgroundRestricted: boolean;
  standbyBucket: number | null;
};

/** One entry of Android's ApplicationExitInfo, with codes left as numbers. */
export type NativeProcessExit = {
  timestampMs: number;
  reason: number;
  status: number;
  importance: number;
  pssKb: number;
  rssKb: number;
  description: string | null;
};

type YonderDeviceHealthModule = {
  getPowerState(): NativePowerState;
  getProcessExits(): NativeProcessExit[];
  canPostNotifications(): boolean;
  openBatterySettings(backgroundRestricted: boolean): boolean;
  showNotification(id: number, title: string, body: string, url: string): boolean;
};

/** Null on iOS, web, and builds made before the module existed. */
export const YonderDeviceHealth =
  requireOptionalNativeModule<YonderDeviceHealthModule>("YonderDeviceHealth");
