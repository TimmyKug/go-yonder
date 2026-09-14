import { CountryCoverageAccumulator, CountryIndex, type CountryCollection } from "../domain/country-coverage";

import type { SqlDatabase } from "./sql-database";

let index: CountryIndex | undefined;
function getIndex() {
  // Load only when the user first zooms out to the country overview.
  index ??= new CountryIndex(require("./countries/boundaries.json") as CountryCollection);
  return index;
}

export async function readCountrySummary(database: SqlDatabase, countryIndex = getIndex(), cancelled = () => false) {
  const summary = new CountryCoverageAccumulator(countryIndex);
  let cursor = "";
  while (!cancelled()) {
    const rows = await database.all<{ cell_id: string; first_seen_at_ms: number }>(
      `SELECT cell_id, first_seen_at_ms FROM unlocked_cells
       WHERE resolution = 11 AND cell_id > ? ORDER BY cell_id LIMIT 256`, [cursor],
    );
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += 1) {
      if (cancelled()) return undefined;
      const row = rows[i]!;
      summary.add(row.cell_id, row.first_seen_at_ms);
      // Yield between small groups so a large imported history does not block gestures.
      if (i % 16 === 15) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    cursor = rows.at(-1)!.cell_id;
  }
  return cancelled() ? undefined : summary.result();
}
