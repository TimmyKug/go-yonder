import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const LOCATION_TASK_CONSUMER =
  "node_modules/expo-location/android/src/main/java/expo/modules/location/taskConsumers/LocationTaskConsumer.kt";
const DEVICE_HEALTH_MODULE =
  "modules/yonder-device-health/android/src/main/java/expo/modules/yonderdevicehealth/YonderDeviceHealthModule.kt";
const TASK_MANAGER_MANIFEST =
  "node_modules/expo-task-manager/android/src/main/AndroidManifest.xml";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("expo-location boot restore patch", () => {
  it("starts the foreground service from the boot and update broadcasts", () => {
    const source = read(LOCATION_TASK_CONSUMER);

    expect(source).toContain("Intent.ACTION_BOOT_COMPLETED");
    expect(source).toContain("Intent.ACTION_MY_PACKAGE_REPLACED");
    expect(source).toContain(
      "override fun canReceiveCustomBroadcast(action: String?): Boolean",
    );
    expect(source).toContain(
      "maybeStartForegroundService(allowFromBackground = true,",
    );
    expect(source).toContain("Manifest.permission.ACCESS_BACKGROUND_LOCATION");
  });

  it("notes each restart where the device-health module reads it", () => {
    const source = read(LOCATION_TASK_CONSUMER);
    const module = read(DEVICE_HEALTH_MODULE);

    for (const outcome of [
      "service-started",
      "service-not-promoted",
      "start-not-allowed",
      "no-background-permission",
      "no-foreground-service",
    ]) {
      expect(source).toContain(`"${outcome}"`);
    }
    for (const constant of [
      'RESTORE_PREFERENCES = "yonder-task-restore"',
      'RESTORE_ENTRIES_KEY = "entries"',
    ]) {
      expect(source).toContain(constant);
      expect(module).toContain(constant);
    }
  });

  it("relies on Task Manager receiving those broadcasts", () => {
    const manifest = read(TASK_MANAGER_MANIFEST);

    expect(manifest).toContain("android.intent.action.BOOT_COMPLETED");
    expect(manifest).toContain("android.intent.action.MY_PACKAGE_REPLACED");
  });
});
