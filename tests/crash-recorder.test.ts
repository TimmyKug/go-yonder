import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("native crash recorder", () => {
  it("is installed by a content provider, which runs before the app in every process", () => {
    const manifest = read("modules/yonder-device-health/android/src/main/AndroidManifest.xml");

    expect(manifest).toContain('android:name="expo.modules.yonderdevicehealth.CrashRecorderProvider"');
    expect(manifest).toContain('android:exported="false"');
  });

  it("ships R8's mapping file with each release so obfuscated frames can be read", () => {
    const workflow = read(".github/workflows/android-release.yml");

    expect(workflow).toContain("outputs/mapping/release/mapping.txt");
    expect(workflow).toContain('"Yonder-${RELEASE_TAG#v}-mapping.txt"');
  });
});
