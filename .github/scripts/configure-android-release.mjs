import { readFile, writeFile } from "node:fs/promises";

import { parseReleaseVersion } from "./release-version.mjs";

const [tag, configPath = "app.json"] = process.argv.slice(2);
if (!/^v/.test(tag ?? "")) {
  throw new Error(
    "Release tag must use the form vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-beta.N",
  );
}
const { version, versionCode } = parseReleaseVersion(tag.slice(1));

const config = JSON.parse(await readFile(configPath, "utf8"));
config.expo.version = version;
config.expo.android ??= {};
config.expo.android.versionCode = versionCode;

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Configured Android ${config.expo.version} (${versionCode})`);
