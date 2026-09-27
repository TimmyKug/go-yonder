import type { RegionCollection } from "../domain/country-coverage";

let regions: RegionCollection | undefined;

/** Parse the bundled region borders only when they are first needed. */
export function getRegions(): RegionCollection {
  regions ??= require("./regions/regions.json") as RegionCollection;
  return regions;
}
