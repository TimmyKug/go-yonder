import { readFile } from "node:fs/promises";

import { parseReleaseVersion } from "./release-version.mjs";

// Usage: check-version.mjs <app.json> <package.json> <package-lock.json> [base app.json]
// Fails when a merge would make "Release on merge" stop after tagging.
const [appPath, packagePath, lockPath, baseAppPath] = process.argv.slice(2);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const app = await readJson(appPath);
const pkg = await readJson(packagePath);
const lock = await readJson(lockPath);
const errors = [];

const version = app.expo?.version;
let expected;
try {
  expected = parseReleaseVersion(version);
} catch (error) {
  errors.push(`app.json version ${version}: ${error.message}`);
}
if (expected && app.expo?.android?.versionCode !== expected.versionCode) {
  errors.push(
    `app.json android.versionCode is ${app.expo?.android?.versionCode}; version ${version} needs ${expected.versionCode}`,
  );
}
for (const [label, other] of [
  ["package.json version", pkg.version],
  ["package-lock.json version", lock.version],
  ['package-lock.json packages[""].version', lock.packages?.[""]?.version],
]) {
  if (other !== version) errors.push(`${label} is ${other}; app.json has ${version}`);
}

let changed = false;
if (baseAppPath) {
  const base = await readJson(baseAppPath);
  changed = base.expo?.version !== version;
  const baseCode = base.expo?.android?.versionCode;
  if (changed && expected && !(expected.versionCode > baseCode)) {
    errors.push(
      `versionCode ${expected.versionCode} must be higher than ${baseCode} on the base branch, or Android will not update`,
    );
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`Version ${version} (${expected.versionCode})${changed ? " is a new release" : ""}`);
