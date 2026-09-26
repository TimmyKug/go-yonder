import type {
  StyleSpecification,
  SymbolLayerSpecification,
} from "@maplibre/maplibre-react-native";

export const OPENSTREETMAP_COPYRIGHT_URL =
  "https://www.openstreetmap.org/copyright";
export const OPENMAPTILES_URL = "https://openmaptiles.org/";
export const OPENFREEMAP_URL = "https://openfreemap.org/";
export const BUY_ME_A_COFFEE_URL = "https://www.buymeacoffee.com/timmykug";
export const SOURCE_CODE_URL = "https://github.com/TimmyKug/go-yonder";

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

/** Colors of the bundled offline map, echoing the online Positron and dark styles. */
export const OFFLINE_MAP_COLORS = {
  light: { water: "#D4DADC", land: "#F2F2EF" },
  dark: { water: "#0C1317", land: "#1E2528" },
} as const satisfies Record<MapTheme, { water: string; land: string }>;

/**
 * A style that needs no network: only a water background. The map view draws
 * land and country borders from the bundled country geometry on top of it.
 */
export function getOfflineMapStyle(theme: MapTheme): StyleSpecification {
  return {
    version: 8,
    name: `yonder-offline-${theme}`,
    sources: {},
    layers: [
      {
        id: "offline-water",
        type: "background",
        paint: { "background-color": OFFLINE_MAP_COLORS[theme].water },
      },
    ],
  };
}

export const DARK_PLACE_LABEL_COLOR = "#FFFFFF";

const PLACE_LABEL_LAYER_PREFIX = "place_";

type TextField = NonNullable<SymbolLayerSpecification["layout"]>["text-field"];

/** Single English/Latin line, instead of the style's stacked latin/non-latin pair. */
const LATIN_LABEL_TEXT_FIELD = [
  "coalesce",
  ["get", "name_en"],
  ["get", "name:latin"],
  ["get", "name"],
] as TextField;

/** Zoom at which a crowding label layer starts drawing. */
const PLACE_LABEL_MIN_ZOOM: Record<string, number> = {
  place_city: 5,
  place_city_large: 5,
  place_country_minor: 1.5,
  place_country_other: 2.5,
  place_state: 5,
};

export function withReadablePlaceLabels(
  style: StyleSpecification,
): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (
        layer.type !== "symbol" ||
        !layer.id.startsWith(PLACE_LABEL_LAYER_PREFIX)
      ) {
        return layer;
      }

      const minzoom = PLACE_LABEL_MIN_ZOOM[layer.id];

      return {
        ...layer,
        ...(minzoom === undefined ? {} : { minzoom }),
        layout: { ...layer.layout, "text-field": LATIN_LABEL_TEXT_FIELD },
        paint: { ...layer.paint, "text-color": DARK_PLACE_LABEL_COLOR },
      };
    }),
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

    return withReadablePlaceLabels((await response.json()) as StyleSpecification);
  } catch {
    return style;
  }
}

export const INITIAL_MAP_VIEW = {
  center: [13.405, 52.52] as [longitude: number, latitude: number],
  zoom: 13,
};
