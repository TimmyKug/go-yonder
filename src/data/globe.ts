import type { GlobeFeature } from "../domain/globe-projection";

let outlines: GlobeFeature[] | undefined;

/** Parse the coarse globe outlines only when the globe is first drawn. */
export function getGlobeFeatures(): GlobeFeature[] {
  outlines ??= (require("./countries/globe.json") as { features: GlobeFeature[] }).features;
  return outlines;
}
