import { describe, expect, it } from "vitest";

import {
  OPENSTREETMAP_COPYRIGHT_URL,
  OPENSTREETMAP_RASTER_STYLE,
} from "@/src/config/map-config";

describe("default map configuration", () => {
  it("uses attributed official OpenStreetMap raster tiles", () => {
    expect(OPENSTREETMAP_COPYRIGHT_URL).toBe(
      "https://www.openstreetmap.org/copyright",
    );
    expect(OPENSTREETMAP_RASTER_STYLE).toMatchObject({
      version: 8,
      sources: {
        openstreetmap: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 19,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [
        {
          id: "openstreetmap",
          type: "raster",
          source: "openstreetmap",
        },
      ],
    });
  });
});
