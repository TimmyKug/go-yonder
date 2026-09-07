import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getMapStyle,
  INITIAL_MAP_VIEW,
  OPENFREEMAP_URL,
  OPENSTREETMAP_COPYRIGHT_URL,
} from "@/src/config/map-config";
import { unlockedCellIdsToVeilMask } from "@/src/domain/hex-grid";

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
  hexagons: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  isExportingBackup: boolean;
  isLoadingHexagons: boolean;
  onBoundsChange: (bounds: [number, number, number, number]) => void;
  onExportBackup: () => void;
  onTrackingAction?: () => void;
  tracking: TrackingPresentation;
};

const EMPTY_POINT_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

const MAP_THEME = {
  light: {
    background: "#071520",
    border: "rgba(234, 247, 255, 0.18)",
    frontier: "#D5F0E9",
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
    border: "rgba(113, 230, 203, 0.2)",
    frontier: "#71E6CB",
    location: "#29D8B5",
    pressedSurface: "rgba(18, 48, 55, 0.98)",
    secondaryText: "#B7CEC9",
    surface: "rgba(3, 12, 17, 0.9)",
    strongSurface: "rgba(3, 12, 17, 0.95)",
    text: "#F2FCF9",
    veil: "#00070B",
    veilOpacity: 0.5,
  },
} as const;

export function YonderMapView({
  currentCoordinate,
  hexagons,
  isExportingBackup,
  isLoadingHexagons,
  onBoundsChange,
  onExportBackup,
  onTrackingAction,
  tracking,
}: YonderMapViewProps) {
  const cameraRef = useRef<CameraRef>(null);
  const hasCenteredOnUser = useRef(false);
  const insets = useSafeAreaInsets();
  const themeName = useColorScheme() === "dark" ? "dark" : "light";
  const colors = MAP_THEME[themeName];
  const mapStyle = useMemo(() => getMapStyle(themeName), [themeName]);
  const usesOpenFreeMap =
    typeof mapStyle === "string" && mapStyle.includes("openfreemap.org");
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapSize, setMapSize] = useState({ height: 0, width: 0 });

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
  const mapVeil = useMemo(
    () =>
      unlockedCellIdsToVeilMask(
        hexagons.features.flatMap((feature) => {
          const cellId = feature.properties?.cellId;

          return typeof cellId === "string" ? [cellId] : [];
        }),
      ),
    [hexagons],
  );

  useEffect(() => {
    if (mapReady && currentCoordinate && !hasCenteredOnUser.current) {
      hasCenteredOnUser.current = true;
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
    onBoundsChange(event.nativeEvent.bounds);
  };

  const handleRecenter = () => {
    if (!currentCoordinate) {
      return;
    }

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
          compass
          compassPosition={{ top: insets.top + 14, right: 14 }}
          logo={false}
          mapStyle={mapStyle}
          onDidFailLoadingMap={() => setMapFailed(true)}
          onDidFinishLoadingMap={() => {
            setMapFailed(false);
            setMapReady(true);
          }}
          onRegionDidChange={handleRegionDidChange}
          style={{ flex: 1 }}
          tintColor={colors.text}
          touchPitch={false}
        >
          <Camera
            initialViewState={INITIAL_MAP_VIEW}
            maxZoom={20}
            minZoom={2}
            ref={cameraRef}
          />

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
                "line-opacity": 0.7,
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

        <Pressable
          accessibilityLabel="Export Yonder backup"
          accessibilityRole="button"
          disabled={isExportingBackup}
          onPress={onExportBackup}
          testID="export-backup"
          style={({ pressed }) => ({
            alignItems: "center",
            alignSelf: "flex-end",
            backgroundColor: pressed
              ? colors.pressedSurface
              : colors.surface,
            borderColor: colors.border,
            borderCurve: "continuous",
            borderRadius: 18,
            borderWidth: 1,
            justifyContent: "center",
            minHeight: 38,
            minWidth: 78,
            paddingHorizontal: 12,
            position: "absolute",
            right: 0,
          })}
        >
          {isExportingBackup ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>
              Backup
            </Text>
          )}
        </Pressable>
      </View>

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
            bottom: 134 + insets.bottom,
            height: 48,
            justifyContent: "center",
            position: "absolute",
            right: 14,
            width: 48,
          })}
        >
          <Text style={{ color: colors.text, fontSize: 24, lineHeight: 26 }}>◎</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityLabel="Open map attribution and licence information"
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(
            usesOpenFreeMap
              ? OPENFREEMAP_URL
              : OPENSTREETMAP_COPYRIGHT_URL,
          );
        }}
        style={({ pressed }) => ({
          backgroundColor: pressed
            ? colors.pressedSurface
            : colors.surface,
          borderRadius: 8,
          bottom: 190 + insets.bottom,
          left: 12,
          paddingHorizontal: 8,
          paddingVertical: 5,
          position: "absolute",
        })}
      >
        <Text style={{ color: colors.text, fontSize: 11, fontWeight: "600" }}>
          {usesOpenFreeMap
            ? "OpenFreeMap · © OpenMapTiles · © OpenStreetMap"
            : "© OpenStreetMap contributors"}
        </Text>
      </Pressable>

      <View
        testID="tracking-status-card"
        style={{
          backgroundColor: colors.strongSurface,
          borderColor: colors.border,
          borderCurve: "continuous",
          borderRadius: 24,
          borderWidth: 1,
          bottom: insets.bottom + 12,
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
    </View>
  );
}
