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

/** A restart of the location task after a reboot or app update. */
export type NativeTaskRestore = {
  atMs: number;
  trigger: string | null;
  outcome: string | null;
};

/** An uncaught exception recorded by the crash recorder before the process died. */
export type NativeCrash = {
  atMs: number;
  processStartedAtMs: number;
  thread: string;
  exception: string;
  cause: string | null;
  frames: string[];
};

type YonderDeviceHealthModule = {
  getPowerState(): NativePowerState;
  getProcessExits(): NativeProcessExit[];
  takeTaskRestores(): NativeTaskRestore[];
  takeCrashes(): NativeCrash[];
  canPostNotifications(): boolean;
  openBatterySettings(backgroundRestricted: boolean): boolean;
  showNotification(id: number, title: string, body: string, url: string): boolean;
};

/** Null on iOS, web, and builds made before the module existed. */
export const YonderDeviceHealth =
  requireOptionalNativeModule<YonderDeviceHealthModule>("YonderDeviceHealth");
