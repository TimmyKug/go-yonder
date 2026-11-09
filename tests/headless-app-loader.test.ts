import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type BuildPropertiesPlugin = [string, { android?: { enableMinifyInReleaseBuilds?: boolean; extraProguardRules?: string } }];

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("headless app loader in release builds", () => {
  it("is kept by R8, because expo-task-manager loads it by name for background starts", () => {
    const appJson = JSON.parse(read("app.json")) as { expo: { plugins: unknown[] } };
    const buildProperties = appJson.expo.plugins.find(
      (plugin): plugin is BuildPropertiesPlugin => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
    );

    expect(buildProperties?.[1].android?.enableMinifyInReleaseBuilds).toBe(true);
    expect(buildProperties?.[1].android?.extraProguardRules).toContain(
      "-keep class * implements expo.modules.apploader.HeadlessAppLoader { <init>(); }",
    );
  });

  it("is still looked up by the class name in Expo's manifest metadata", () => {
    const manifest = read("node_modules/expo-modules-core/android/src/main/AndroidManifest.xml");

    expect(manifest).toContain('android:name="org.unimodules.core.AppLoader#react-native-headless"');
    expect(manifest).toContain('android:value="expo.modules.adapters.react.apploader.RNHeadlessAppLoader"');
  });
});
