import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = join(__dirname, "..", ".github", "scripts", "check-version.mjs");

type Versions = { app?: string; code?: number; pkg?: string; lock?: string; base?: [string, number] };

async function check({ app = "1.2.3-beta.4", code = 100_200_304, pkg = app, lock = app, base }: Versions) {
  const directory = await mkdtemp(join(tmpdir(), "yonder-version-"));
  const path = (name: string) => join(directory, name);
  await writeFile(path("app.json"), JSON.stringify({ expo: { version: app, android: { versionCode: code } } }));
  await writeFile(path("package.json"), JSON.stringify({ version: pkg }));
  await writeFile(path("package-lock.json"), JSON.stringify({ version: lock, packages: { "": { version: lock } } }));
  const args = [script, path("app.json"), path("package.json"), path("package-lock.json")];
  if (base) {
    await writeFile(path("base.json"), JSON.stringify({ expo: { version: base[0], android: { versionCode: base[1] } } }));
    args.push(path("base.json"));
  }
  return run(process.execPath, args);
}

describe("check-version", () => {
  it("accepts matching versions and a higher versionCode than the base", async () => {
    await expect(check({ base: ["1.2.3-beta.3", 100_200_303] })).resolves.toMatchObject({
      stdout: "Version 1.2.3-beta.4 (100200304) is a new release\n",
    });
    await expect(check({ base: ["1.2.3-beta.4", 100_200_304] })).resolves.toMatchObject({
      stdout: "Version 1.2.3-beta.4 (100200304)\n",
    });
  });

  it.each<[string, Versions, RegExp]>([
    ["a versionCode that does not follow the formula", { code: 100_200_399 }, /needs 100200304/],
    ["a package.json that disagrees", { pkg: "1.2.3" }, /package\.json version is 1\.2\.3/],
    ["a stale package-lock.json", { lock: "1.2.2" }, /package-lock\.json version is 1\.2\.2/],
    ["an invalid version", { app: "1.2", code: 1 }, /MAJOR\.MINOR\.PATCH/],
    ["a version that would not update Android", { base: ["1.2.3", 100_200_399] }, /must be higher than 100200399/],
  ])("rejects %s", async (_label, versions, message) => {
    await expect(check(versions)).rejects.toMatchObject({ stderr: expect.stringMatching(message) });
  });
});
