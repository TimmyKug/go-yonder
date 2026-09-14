import type { CountryCollection } from "../domain/country-coverage";

let countries: CountryCollection | undefined;

/** Parse the shared country geometry only when the overview is first opened. */
export function getCountries(): CountryCollection {
  countries ??= require("./countries/countries.json") as CountryCollection;
  return countries;
}
