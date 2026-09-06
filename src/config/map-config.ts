import type { StyleSpecification } from "@maplibre/maplibre-react-native";

export const OPENSTREETMAP_COPYRIGHT_URL =
  "https://www.openstreetmap.org/copyright";

export const OPENSTREETMAP_RASTER_STYLE: StyleSpecification = {
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
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

export const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim() ||
  OPENSTREETMAP_RASTER_STYLE;

export const INITIAL_MAP_VIEW = {
  center: [13.405, 52.52] as [longitude: number, latitude: number],
  zoom: 13,
};
