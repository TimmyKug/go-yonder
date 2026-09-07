import { readFile, writeFile } from "node:fs/promises";

const [buildGradlePath = "android/app/build.gradle"] = process.argv.slice(2);
let gradle = await readFile(buildGradlePath, "utf8");

const signingMarker = "    signingConfigs {\n        debug {";
if (!gradle.includes(signingMarker)) {
  throw new Error("Could not find the Android signingConfigs block");
}

gradle = gradle.replace(
  signingMarker,
  `    signingConfigs {
        release {
            storeFile file(System.getenv("YONDER_RELEASE_STORE_FILE"))
            storePassword System.getenv("YONDER_RELEASE_STORE_PASSWORD")
            keyAlias System.getenv("YONDER_RELEASE_KEY_ALIAS")
            keyPassword System.getenv("YONDER_RELEASE_KEY_PASSWORD")
        }
        debug {`,
);

const buildTypesMarker = "    buildTypes {";
const releaseBuildMarker = "        release {";
const buildTypesIndex = gradle.indexOf(buildTypesMarker);
const releaseBuildIndex = gradle.indexOf(releaseBuildMarker, buildTypesIndex);
const releaseSigningValue = "signingConfig signingConfigs.debug";
const releaseSigningIndex = gradle.indexOf(
  releaseSigningValue,
  releaseBuildIndex,
);
if (
  buildTypesIndex < 0 ||
  releaseBuildIndex < 0 ||
  releaseSigningIndex < 0
) {
  throw new Error("Could not find the Android release signing configuration");
}

gradle = `${gradle.slice(0, releaseSigningIndex)}signingConfig signingConfigs.release${gradle.slice(releaseSigningIndex + releaseSigningValue.length)}`;
await writeFile(buildGradlePath, gradle);
console.log("Configured dedicated Android release signing");
