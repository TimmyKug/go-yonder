import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCountrySummary } from "../hooks/use-country-summary";

import {
  getMapStyle,
  INITIAL_MAP_VIEW,
  OPENMAPTILES_URL,
  OPENSTREETMAP_COPYRIGHT_URL,
} from "@/src/config/map-config";
import { getCountries } from "@/src/data/countries";
import { COUNTRY_OVERVIEW_ZOOM, type CountryCollection } from "@/src/domain/country-coverage";
import { cellIdsAtDisplayResolution, displayResolutionForZoom, isValidMapZoom, MAX_MAP_ZOOM, MIN_MAP_ZOOM } from "@/src/domain/hex-display";
import { unlockedCellIdsToVeilMask } from "@/src/domain/hex-grid";
import { useAppearance } from "@/src/features/appearance/appearance-provider";

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type TrackingPresentation = {
  actionLabel?: string;
  detail: string;
  isBusy: boolean;
  kind: "active" | "needs-action" | "unavailable";
  title: string;
};

type YonderMapViewProps = {
  currentCoordinate?: MapCoordinate;
  countryRefreshToken?: number;
  hexagons: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  isLoadingHexagons: boolean;
  onBoundsChange: (bounds: [number, number, number, number]) => void;
  onOpenSettings: () => void;
  onTrackingAction?: () => void;
  tracking: TrackingPresentation;
};

const EMPTY_POINT_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

const ANDROID_ZOOM_RATE = 1.6;

const MAP_THEME = {
  light: {
    background: "#071520",
    border: "rgba(234, 247, 255, 0.18)",
    frontier: "#D5F0E9",
    frontierOpacity: 0.7,
    location: "#087CFF",
    pressedSurface: "rgba(19, 48, 66, 0.98)",
    secondaryText: "#BFD2DD",
    surface: "rgba(7, 21, 32, 0.88)",
    strongSurface: "rgba(7, 21, 32, 0.94)",
    text: "#F6FCFF",
    veil: "#071520",
    veilOpacity: 0.38,
  },
  dark: {
    background: "#03090D",
    border: "rgba(196, 207, 210, 0.2)",
    frontier: "#C4CFD2",
    frontierOpacity: 0.38,
    location: "#29D8B5",
    pressedSurface: "rgba(18, 48, 55, 0.98)",
    secondaryText: "#B7CEC9",
    surface: "rgba(3, 12, 17, 0.9)",
    strongSurface: "rgba(3, 12, 17, 0.95)",
    text: "#F2FCF9",
    veil: "#AEB7BB",
    veilOpacity: 0.3,
  },
} as const;

export function YonderMapView({
  currentCoordinate,
  countryRefreshToken,
  hexagons,
  isLoadingHexagons,
  onBoundsChange,
  onOpenSettings,
  onTrackingAction,
  tracking,
}: YonderMapViewProps) {
  const cameraRef = useRef<CameraRef>(null);
  const hasCenteredOnUser = useRef(false);
  const insets = useSafeAreaInsets();
  const { resolvedAppearance: themeName } = useAppearance();
  const colors = MAP_THEME[themeName];
  const mapStyle = useMemo(() => getMapStyle(themeName), [themeName]);
  const usesOpenFreeMap =
    typeof mapStyle === "string" && mapStyle.includes("openfreemap.org");
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapSize, setMapSize] = useState({ height: 0, width: 0 });
  const [isAttributionVisible, setIsAttributionVisible] = useState(false);
  const [countryOverview, setCountryOverview] = useState(
    () => INITIAL_MAP_VIEW.zoom <= COUNTRY_OVERVIEW_ZOOM,
  );
  const countrySummary = useCountrySummary(countryOverview, countryRefreshToken);
  const countryOverlay = useMemo<CountryCollection>(() => {
    if (!countryOverview || !countrySummary.countries?.length) {
      return { type: "FeatureCollection", features: [] };
    }
    const visited = new Set(countrySummary.countries.map(({ id }) => id));
    const boundaries = getCountries();
    return { type: "FeatureCollection", features: boundaries.features.filter(({ properties }) => visited.has(properties.id)) };
  }, [countryOverview, countrySummary.countries]);
  const [displayResolution, setDisplayResolution] = useState(() =>
    displayResolutionForZoom(INITIAL_MAP_VIEW.zoom),
  );

  const currentPoint = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    if (!currentCoordinate) {
      return EMPTY_POINT_COLLECTION;
    }

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [
              currentCoordinate.longitude,
              currentCoordinate.latitude,
            ],
          },
        },
      ],
    };
  }, [currentCoordinate]);
  const loadedCellIds = useMemo(
    () => hexagons.features.flatMap((feature) => {
      const cellId = feature.properties?.cellId;
      return typeof cellId === "string" ? [cellId] : [];
    }),
    [hexagons],
  );
  const mapVeil = useMemo(
    () => unlockedCellIdsToVeilMask(
      cellIdsAtDisplayResolution(loadedCellIds, displayResolution),
    ),
    [loadedCellIds, displayResolution],
  );

  useEffect(() => {
    if (mapReady && currentCoordinate && !hasCenteredOnUser.current) {
      hasCenteredOnUser.current = true;
      setDisplayResolution(displayResolutionForZoom(15));
      cameraRef.current?.jumpTo({
        center: [currentCoordinate.longitude, currentCoordinate.latitude],
        zoom: 15,
      });
    }
  }, [currentCoordinate, mapReady]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    setMapSize({ height, width });
  };

  const handleRegionDidChange = (
    event: NativeSyntheticEvent<ViewStateChangeEvent>,
  ) => {
    handleRegionIsChanging(event);
    onBoundsChange(event.nativeEvent.bounds);
  };

  const handleRegionIsChanging = (
    event: NativeSyntheticEvent<ViewStateChangeEvent>,
  ) => {
    const zoom = event.nativeEvent.zoom;
    // The map reports zoom 0 while it initialises, below the camera's own
    // minimum. Acting on it would scan every country before the first frame.
    if (!isValidMapZoom(zoom)) return;
    setDisplayResolution((current) => displayResolutionForZoom(zoom, current));
    setCountryOverview((current) => zoom <= COUNTRY_OVERVIEW_ZOOM + (current ? 0.3 : 0.15));
  };

  const handleRecenter = () => {
    if (!currentCoordinate) {
      return;
    }

    setDisplayResolution(displayResolutionForZoom(15));
    cameraRef.current?.jumpTo({
      center: [currentCoordinate.longitude, currentCoordinate.latitude],
      zoom: 15,
    });
  };

  const canMountMap = mapSize.height > 0 && mapSize.width > 0;

  return (
    <View
      onLayout={handleLayout}
      style={{ flex: 1, backgroundColor: colors.background }}
      testID="yonder-screen"
    >
      {canMountMap ? (
        <Map
          attribution={false}
          compass={false}
          logo={false}
          mapStyle={mapStyle}
          zoomRate={Platform.OS === "android" ? ANDROID_ZOOM_RATE : undefined}
          onDidFailLoadingMap={() => setMapFailed(true)}
          onDidFinishLoadingMap={() => {
            setMapFailed(false);
            setMapReady(true);
          }}
          onRegionDidChange={handleRegionDidChange}
          onRegionIsChanging={handleRegionIsChanging}
          style={{ flex: 1 }}
          tintColor={colors.text}
          touchPitch={false}
          touchRotate={false}
        >
          <Camera
            initialViewState={INITIAL_MAP_VIEW}
            maxZoom={MAX_MAP_ZOOM}
            minZoom={MIN_MAP_ZOOM}
            ref={cameraRef}
          />

          <GeoJSONSource data={countryOverlay} id="visited-countries">
            <Layer
              id="visited-country-fill"
              type="fill"
              paint={{
                "fill-color": themeName === "dark" ? "#03090D" : "#657583",
                "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6.25, 0.22, 7.15, 0],
              }}
            />
            <Layer
              id="visited-country-border"
              type="line"
              paint={{
                "line-color": themeName === "dark" ? "#C4CFD2" : "#516776",
                "line-width": 1.3,
                "line-opacity": ["interpolate", ["linear"], ["zoom"], 6.25, 0.85, 7.15, 0],
              }}
            />
          </GeoJSONSource>

          <GeoJSONSource data={mapVeil} id="map-veil">
            <Layer
              id="map-veil-fill"
              paint={{
                "fill-color": colors.veil,
                "fill-opacity": colors.veilOpacity,
              }}
              type="fill"
            />
            <Layer
              id="map-veil-frontier"
              paint={{
                "line-color": colors.frontier,
                "line-opacity": colors.frontierOpacity,
                "line-width": 1.2,
              }}
              type="line"
            />
          </GeoJSONSource>

          <GeoJSONSource data={currentPoint} id="current-location">
            <Layer
              id="current-location-halo"
              paint={{
                "circle-color": colors.text,
                "circle-opacity": 0.3,
                "circle-radius": 15,
              }}
              type="circle"
            />
            <Layer
              id="current-location-dot"
              paint={{
                "circle-color": colors.location,
                "circle-radius": 7,
                "circle-stroke-color": "#FFFFFF",
                "circle-stroke-width": 3,
              }}
              type="circle"
            />
          </GeoJSONSource>
        </Map>
      ) : null}

      {!mapReady && !mapFailed ? (
        <View
          pointerEvents="none"
          style={{
            alignItems: "center",
            bottom: 0,
            justifyContent: "center",
            left: 0,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        >
          <ActivityIndicator color={colors.text} size="large" />
          <Text
            selectable
            style={{ color: colors.secondaryText, fontSize: 14, paddingTop: 12 }}
          >
            Loading map…
          </Text>
        </View>
      ) : null}

      {mapFailed ? (
        <View
          style={{
            alignItems: "center",
            bottom: 0,
            justifyContent: "center",
            left: 0,
            padding: 28,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        >
          <Text
            selectable
            style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}
          >
            The map could not load
          </Text>
          <Text
            selectable
            style={{
              color: colors.secondaryText,
              fontSize: 15,
              lineHeight: 21,
              paddingTop: 8,
              textAlign: "center",
            }}
          >
            Check your connection and reopen the app. Your unlocked places remain
            stored on this device.
          </Text>
        </View>
      ) : null}

      <View
        pointerEvents="box-none"
        style={{
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          left: 14,
          position: "absolute",
          right: 14,
          top: insets.top + 12,
        }}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderCurve: "continuous",
            borderRadius: 18,
            borderWidth: 1,
            flexDirection: "row",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 9,
          }}
        >
          <View
            style={{
              backgroundColor:
                tracking.kind === "active" ? "#00D4A8" : "#F2A83B",
              borderRadius: 4,
              height: 8,
              width: 8,
            }}
          />
          <Text
            selectable
            style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}
          >
            {tracking.kind === "active" ? "Saving on-device" : "Yonder"}
          </Text>
          {isLoadingHexagons ? (
            <ActivityIndicator color={colors.secondaryText} size="small" />
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityLabel="Open Yonder settings"
            accessibilityRole="button"
            onPress={onOpenSettings}
            testID="open-settings"
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: pressed
                ? colors.pressedSurface
                : colors.surface,
              borderColor: colors.border,
              borderCurve: "continuous",
              borderRadius: 18,
              borderWidth: 1,
              justifyContent: "center",
              minHeight: 38,
              paddingHorizontal: 12,
            })}
          >
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>
              Settings
            </Text>
          </Pressable>
        </View>
      </View>

      {countryOverview ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={countrySummary.error ? "Retry loading countries" : "Show visited countries and uncovered percentages"}
          onPress={() => countrySummary.error ? countrySummary.refresh() : router.push("/countries")}
          testID="country-count"
          style={({ pressed }) => ({
            position: "absolute", left: 14, top: insets.top + 64,
            flexDirection: "row", alignItems: "center", gap: 10,
            minHeight: 44, paddingHorizontal: 14, paddingVertical: 10,
            borderRadius: 18, borderCurve: "continuous", borderWidth: 1,
            borderColor: colors.border, backgroundColor: pressed ? colors.pressedSurface : colors.surface,
          })}
        >
          {countrySummary.loading ? <ActivityIndicator color={colors.secondaryText} size="small" /> : null}
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
            {countrySummary.error ? "Countries unavailable · Retry" : countrySummary.countries
              ? `${countrySummary.countries.length} ${countrySummary.countries.length === 1 ? "country" : "countries"} visited`
              : "Loading countries…"}
          </Text>
          {!countrySummary.error ? <Text style={{ color: colors.secondaryText, fontSize: 22 }}>›</Text> : null}
        </Pressable>
      ) : null}

      {currentCoordinate ? (
        <Pressable
          accessibilityLabel="Center map on my location"
          accessibilityRole="button"
          onPress={handleRecenter}
          testID="recenter-map"
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: pressed
              ? colors.pressedSurface
              : colors.surface,
            borderColor: colors.border,
            borderRadius: 24,
            borderWidth: 1,
            bottom:
              tracking.kind === "active"
                ? Math.max(insets.bottom - 7, 3)
                : insets.bottom + 154,
            height: 48,
            justifyContent: "center",
            position: "absolute",
            right: 14,
            width: 48,
          })}
        >
          <View
            style={{
              alignItems: "center",
              borderColor: colors.text,
              borderRadius: 13,
              borderWidth: 2.5,
              height: 26,
              justifyContent: "center",
              width: 26,
            }}
          >
            <View
              style={{
                backgroundColor: colors.text,
                borderRadius: 4,
                height: 8,
                width: 8,
              }}
            />
          </View>
        </Pressable>
      ) : null}

      <View
        pointerEvents="box-none"
        style={{
          alignItems: "flex-end",
          bottom: Math.max(insets.bottom - 7, 3),
          flexDirection: "row",
          gap: 6,
          left: 12,
          position: "absolute",
          right: 12,
        }}
      >
        <Pressable
          accessibilityLabel={
            isAttributionVisible
              ? "Hide map attribution"
              : "Show map attribution"
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: isAttributionVisible }}
          hitSlop={4}
          onPress={() => setIsAttributionVisible((visible) => !visible)}
          testID="map-attribution-toggle"
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: pressed ? colors.pressedSurface : colors.surface,
            borderColor: colors.border,
            borderCurve: "continuous",
            borderRadius: 16,
            borderWidth: 1,
            height: 32,
            justifyContent: "center",
            width: 32,
          })}
        >
          <Text
            style={{
              color: colors.secondaryText,
              fontSize: 17,
              fontWeight: "700",
              lineHeight: 19,
            }}
          >
            ⓘ
          </Text>
        </Pressable>

        {isAttributionVisible ? (
          <View
            accessibilityLabel="Map attribution"
            style={{
              alignItems: "center",
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderCurve: "continuous",
              borderRadius: 9,
              borderWidth: 1,
              flexDirection: "row",
              gap: 5,
              minHeight: 32,
              paddingHorizontal: 9,
              paddingVertical: 5,
            }}
            testID="map-attribution"
          >
            {usesOpenFreeMap ? (
              <>
                <Pressable
                  accessibilityLabel="Open OpenMapTiles attribution"
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => void Linking.openURL(OPENMAPTILES_URL)}
                >
                  <Text
                    selectable
                    style={{
                      color: colors.secondaryText,
                      fontSize: 10,
                      fontWeight: "600",
                    }}
                  >
                    © OpenMapTiles
                  </Text>
                </Pressable>
                <Text
                  selectable
                  style={{ color: colors.secondaryText, fontSize: 10 }}
                >
                  ·
                </Text>
              </>
            ) : null}
            <Pressable
              accessibilityLabel="Open OpenStreetMap copyright information"
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => void Linking.openURL(OPENSTREETMAP_COPYRIGHT_URL)}
            >
              <Text
                selectable
                style={{
                  color: colors.secondaryText,
                  fontSize: 10,
                  fontWeight: "600",
                }}
              >
                © OpenStreetMap contributors
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {tracking.kind !== "active" ? (
        <View
          testID="tracking-status-card"
          style={{
            backgroundColor: colors.strongSurface,
            borderColor: colors.border,
            borderCurve: "continuous",
            borderRadius: 24,
            borderWidth: 1,
            bottom: insets.bottom + 31,
            gap: 5,
            left: 12,
            padding: 16,
            position: "absolute",
            right: 12,
          }}
        >
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              selectable
              style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}
            >
              {tracking.title}
            </Text>
            <Text
              selectable
              style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 18 }}
            >
              {tracking.detail}
            </Text>
          </View>

          {tracking.actionLabel && onTrackingAction ? (
            <Pressable
              accessibilityLabel={tracking.actionLabel}
              accessibilityRole="button"
              disabled={tracking.isBusy}
              onPress={onTrackingAction}
              testID="tracking-action"
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: pressed ? "#8DEBD8" : "#B8FFEA",
                borderCurve: "continuous",
                borderRadius: 18,
                justifyContent: "center",
                minHeight: 42,
                minWidth: 94,
                opacity: tracking.isBusy ? 0.6 : 1,
                paddingHorizontal: 14,
              })}
            >
              {tracking.isBusy ? (
                <ActivityIndicator color="#062118" size="small" />
              ) : (
                <Text
                  selectable
                  style={{ color: "#062118", fontSize: 14, fontWeight: "700" }}
                >
                  {tracking.actionLabel}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
        </View>
      ) : null}
    </View>
  );
}
