// Shared by the release build and the pull request check, so both apply the
// same version rules.

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

// The last two digits order builds of the same version: beta.1 through
// beta.98 sort before the stable release, which always uses 99.
const STABLE_SUFFIX = 99;

/** Parses MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N and derives its Android versionCode. */
export function parseReleaseVersion(text) {
  const match = VERSION_PATTERN.exec(text ?? "");
  if (!match) {
    throw new Error("Version must use the form MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N");
  }

  const [, majorText, minorText, patchText, betaText] = match;
  const [major, minor, patch] = [majorText, minorText, patchText].map(Number);
  if (minor > 999 || patch > 999) {
    throw new Error("Minor and patch versions must be between 0 and 999");
  }

  const suffix = betaText === undefined ? STABLE_SUFFIX : Number(betaText);
  if (betaText !== undefined && (suffix < 1 || suffix >= STABLE_SUFFIX)) {
    throw new Error("Beta numbers must be between 1 and 98");
  }

  const versionCode = (major * 1_000_000 + minor * 1_000 + patch) * 100 + suffix;
  if (versionCode < 2 || versionCode > 2_100_000_000) {
    throw new Error("Calculated Android versionCode is outside the supported range");
  }

  const version = `${major}.${minor}.${patch}`;
  return {
    version: betaText === undefined ? version : `${version}-beta.${suffix}`,
    versionCode,
  };
}
