import type { StyleSpecification } from "@maplibre/maplibre-react-native";
import { describe, expect, it } from "vitest";

import {
  DARK_PLACE_LABEL_COLOR,
  getMapStyle,
  OPENFREEMAP_URL,
  OPENMAPTILES_URL,
  OPENSTREETMAP_COPYRIGHT_URL,
  OPENSTREETMAP_RASTER_STYLE,
  withBrightPlaceLabels,
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

  it("selects the paired keyless OpenFreeMap styles", () => {
    expect(getMapStyle("light")).toBe(
      "https://tiles.openfreemap.org/styles/positron",
    );
    expect(getMapStyle("dark")).toBe(
      "https://tiles.openfreemap.org/styles/dark",
    );
    expect(OPENFREEMAP_URL).toBe("https://openfreemap.org/");
    expect(OPENMAPTILES_URL).toBe("https://openmaptiles.org/");
  });
});

describe("dark place labels", () => {
  const style = {
    version: 8,
    sources: {},
    layers: [
      {
        id: "place_country_major",
        type: "symbol",
        source: "x",
        paint: { "text-color": "rgb(101,101,101)", "text-halo-width": 1 },
      },
      {
        id: "highway_name_other",
        type: "symbol",
        source: "x",
        paint: { "text-color": "rgb(80,78,78)" },
      },
      { id: "water", type: "fill", source: "x", paint: {} },
    ],
  } as unknown as StyleSpecification;

  it("repaints only place label layers and keeps their other paint", () => {
    const [country, highway, water] = withBrightPlaceLabels(style).layers;

    expect(country).toMatchObject({
      paint: { "text-color": DARK_PLACE_LABEL_COLOR, "text-halo-width": 1 },
    });
    expect(highway).toMatchObject({ paint: { "text-color": "rgb(80,78,78)" } });
    expect(water).toMatchObject({ type: "fill" });
  });

  it("does not mutate the source style", () => {
    withBrightPlaceLabels(style);

    expect(style.layers[0]).toMatchObject({
      paint: { "text-color": "rgb(101,101,101)" },
    });
  });
});
