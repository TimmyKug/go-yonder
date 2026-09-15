import type { StyleSpecification } from "@maplibre/maplibre-react-native";

export const OPENSTREETMAP_COPYRIGHT_URL =
  "https://www.openstreetmap.org/copyright";
export const OPENMAPTILES_URL = "https://openmaptiles.org/";
export const OPENFREEMAP_URL = "https://openfreemap.org/";

export type MapTheme = "dark" | "light";

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

const OPENFREEMAP_STYLE_URLS = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
} as const;

export function getMapStyle(theme: MapTheme): StyleSpecification | string {
  const override =
    theme === "dark"
      ? process.env.EXPO_PUBLIC_MAP_STYLE_DARK_URL?.trim()
      : process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT_URL?.trim();

  if (override) {
    return override;
  }

  return OPENFREEMAP_STYLE_URLS[theme];
}

export const DARK_PLACE_LABEL_COLOR = "#FFFFFF";

const PLACE_LABEL_LAYER_PREFIX = "place_";

export function withBrightPlaceLabels(
  style: StyleSpecification,
): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) =>
      layer.type === "symbol" && layer.id.startsWith(PLACE_LABEL_LAYER_PREFIX)
        ? {
            ...layer,
            paint: { ...layer.paint, "text-color": DARK_PLACE_LABEL_COLOR },
          }
        : layer,
    ),
  };
}

export async function loadMapStyle(
  theme: MapTheme,
): Promise<StyleSpecification | string> {
  const style = getMapStyle(theme);

  if (theme !== "dark" || typeof style !== "string") {
    return style;
  }

  try {
    const response = await fetch(style);

    if (!response.ok) {
      return style;
    }

    return withBrightPlaceLabels((await response.json()) as StyleSpecification);
  } catch {
    return style;
  }
}

export const INITIAL_MAP_VIEW = {
  center: [13.405, 52.52] as [longitude: number, latitude: number],
  zoom: 13,
};
