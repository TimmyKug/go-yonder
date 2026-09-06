import { readFile, writeFile } from "node:fs/promises";

const [tag, configPath = "app.json"] = process.argv.slice(2);
const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? "");

if (!match) throw new Error("Release tag must use the form vMAJOR.MINOR.PATCH");

const [, majorText, minorText, patchText] = match;
const [major, minor, patch] = [majorText, minorText, patchText].map(Number);
if (minor > 999 || patch > 999) {
  throw new Error("Minor and patch versions must be between 0 and 999");
}

const versionCode = major * 1_000_000 + minor * 1_000 + patch;
if (versionCode < 2 || versionCode > 2_100_000_000) {
  throw new Error("Calculated Android versionCode is outside the supported range");
}

const config = JSON.parse(await readFile(configPath, "utf8"));
config.expo.version = `${major}.${minor}.${patch}`;
config.expo.android ??= {};
config.expo.android.versionCode = versionCode;

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Configured Android ${config.expo.version} (${versionCode})`);
