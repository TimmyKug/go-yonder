const DEVELOPMENT_MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export const MAP_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim() || DEVELOPMENT_MAP_STYLE_URL;

export const INITIAL_MAP_VIEW = {
  center: [13.405, 52.52] as [longitude: number, latitude: number],
  zoom: 13,
};
