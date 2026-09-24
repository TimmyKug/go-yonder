import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = join(
  __dirname,
  "..",
  ".github",
  "scripts",
  "configure-android-release.mjs",
);

async function configure(tag: string) {
  const directory = await mkdtemp(join(tmpdir(), "yonder-release-"));
  const configPath = join(directory, "app.json");
  await writeFile(
    configPath,
    JSON.stringify({ expo: { version: "0.0.0", android: { versionCode: 1 } } }),
  );
  await run(process.execPath, [script, tag, configPath]);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return {
    version: config.expo.version as string,
    versionCode: config.expo.android.versionCode as number,
  };
}

describe("configure-android-release", () => {
  it("gives a stable release the highest suffix", async () => {
    await expect(configure("v0.4.5")).resolves.toEqual({
      version: "0.4.5",
      versionCode: 400599,
    });
  });

  it("orders betas between the previous and next stable releases", async () => {
    const previous = await configure("v0.4.4");
    const beta1 = await configure("v0.4.5-beta.1");
    const beta2 = await configure("v0.4.5-beta.2");
    const stable = await configure("v0.4.5");

    expect(beta1).toEqual({ version: "0.4.5-beta.1", versionCode: 400501 });
    expect(previous.versionCode).toBeLessThan(beta1.versionCode);
    expect(beta1.versionCode).toBeLessThan(beta2.versionCode);
    expect(beta2.versionCode).toBeLessThan(stable.versionCode);
  });

  it("stays above every code published with the previous scheme", async () => {
    const { versionCode } = await configure("v0.4.5-beta.1");
    expect(versionCode).toBeGreaterThan(4004);
  });

  it.each(["v0.4.5-beta.0", "v0.4.5-beta.99", "v0.4.5-rc.1", "0.4.5"])(
    "rejects %s",
    async (tag) => {
      await expect(configure(tag)).rejects.toThrow();
    },
  );
});
