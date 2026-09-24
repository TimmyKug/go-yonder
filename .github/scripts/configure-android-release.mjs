import { readFile, writeFile } from "node:fs/promises";

const [tag, configPath = "app.json"] = process.argv.slice(2);
const match = /^v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(tag ?? "");

if (!match) {
  throw new Error(
    "Release tag must use the form vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-beta.N",
  );
}

const [, majorText, minorText, patchText, betaText] = match;
const [major, minor, patch] = [majorText, minorText, patchText].map(Number);
if (minor > 999 || patch > 999) {
  throw new Error("Minor and patch versions must be between 0 and 999");
}

// The last two digits order builds of the same version: beta.1 through
// beta.98 sort before the stable release, which always uses 99.
const STABLE_SUFFIX = 99;
const suffix = betaText === undefined ? STABLE_SUFFIX : Number(betaText);
if (betaText !== undefined && (suffix < 1 || suffix >= STABLE_SUFFIX)) {
  throw new Error("Beta numbers must be between 1 and 98");
}

const versionCode = (major * 1_000_000 + minor * 1_000 + patch) * 100 + suffix;
if (versionCode < 2 || versionCode > 2_100_000_000) {
  throw new Error("Calculated Android versionCode is outside the supported range");
}

const version = `${major}.${minor}.${patch}`;
const config = JSON.parse(await readFile(configPath, "utf8"));
config.expo.version =
  betaText === undefined ? version : `${version}-beta.${suffix}`;
config.expo.android ??= {};
config.expo.android.versionCode = versionCode;

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Configured Android ${config.expo.version} (${versionCode})`);
