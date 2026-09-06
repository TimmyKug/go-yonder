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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  INITIAL_MAP_VIEW,
  MAP_STYLE,
  OPENSTREETMAP_COPYRIGHT_URL,
} from "@/src/config/map-config";

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

type TesseraMapViewProps = {
  currentCoordinate?: MapCoordinate;
  tesserae: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
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

export function TesseraMapView({
  currentCoordinate,
  tesserae,
  isExportingBackup,
  isLoadingHexagons,
  onBoundsChange,
  onExportBackup,
  onTrackingAction,
  tracking,
}: TesseraMapViewProps) {
  const cameraRef = useRef<CameraRef>(null);
  const hasCenteredOnUser = useRef(false);
  const insets = useSafeAreaInsets();
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
      style={{ flex: 1, backgroundColor: "#071520" }}
      testID="tessera-screen"
    >
      {canMountMap ? (
        <Map
          attribution={false}
          compass
          compassPosition={{ top: insets.top + 14, right: 14 }}
          logo={false}
          mapStyle={MAP_STYLE}
          onDidFailLoadingMap={() => setMapFailed(true)}
          onDidFinishLoadingMap={() => {
            setMapFailed(false);
            setMapReady(true);
          }}
          onRegionDidChange={handleRegionDidChange}
          style={{ flex: 1 }}
          tintColor="#EAF7FF"
          touchPitch={false}
        >
          <Camera
            initialViewState={INITIAL_MAP_VIEW}
            maxZoom={20}
            minZoom={2}
            ref={cameraRef}
          />

          <GeoJSONSource data={tesserae} id="locked-tesserae">
            <Layer
              id="locked-tesserae-fill"
              paint={{
                "fill-color": ["get", "fillColor"],
                "fill-opacity": ["get", "fillOpacity"],
              }}
              type="fill"
            />
            <Layer
              id="locked-tesserae-outline"
              paint={{
                "line-color": "#F6E9CC",
                "line-opacity": 0.5,
                "line-width": 0.35,
              }}
              type="line"
            />
          </GeoJSONSource>

          <GeoJSONSource data={currentPoint} id="current-location">
            <Layer
              id="current-location-halo"
              paint={{
                "circle-color": "#F6FCFF",
                "circle-opacity": 0.3,
                "circle-radius": 15,
              }}
              type="circle"
            />
            <Layer
              id="current-location-dot"
              paint={{
                "circle-color": "#087CFF",
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
          <ActivityIndicator color="#EAF7FF" size="large" />
          <Text
            selectable
            style={{ color: "#BFD2DD", fontSize: 14, paddingTop: 12 }}
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
            style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "700" }}
          >
            The map could not load
          </Text>
          <Text
            selectable
            style={{
              color: "#BFD2DD",
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
            backgroundColor: "rgba(7, 21, 32, 0.88)",
            borderColor: "rgba(234, 247, 255, 0.18)",
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
            style={{ color: "#F6FCFF", fontSize: 13, fontWeight: "600" }}
          >
            {tracking.kind === "active" ? "Saving on-device" : "Tessera"}
          </Text>
          {isLoadingHexagons ? (
            <ActivityIndicator color="#BFD2DD" size="small" />
          ) : null}
        </View>

        <Pressable
          accessibilityLabel="Export Tessera backup"
          accessibilityRole="button"
          disabled={isExportingBackup}
          onPress={onExportBackup}
          testID="export-backup"
          style={({ pressed }) => ({
            alignItems: "center",
            alignSelf: "flex-end",
            backgroundColor: pressed
              ? "rgba(19, 48, 66, 0.98)"
              : "rgba(7, 21, 32, 0.88)",
            borderColor: "rgba(234, 247, 255, 0.18)",
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
            <ActivityIndicator color="#EAF7FF" size="small" />
          ) : (
            <Text style={{ color: "#F6FCFF", fontSize: 13, fontWeight: "700" }}>
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
              ? "rgba(19, 48, 66, 0.98)"
              : "rgba(7, 21, 32, 0.9)",
            borderColor: "rgba(234, 247, 255, 0.18)",
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
          <Text style={{ color: "#FFFFFF", fontSize: 24, lineHeight: 26 }}>◎</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityLabel="Open OpenStreetMap copyright and licence information"
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(OPENSTREETMAP_COPYRIGHT_URL);
        }}
        style={({ pressed }) => ({
          backgroundColor: pressed
            ? "rgba(7, 21, 32, 0.92)"
            : "rgba(7, 21, 32, 0.76)",
          borderRadius: 8,
          bottom: 190 + insets.bottom,
          left: 12,
          paddingHorizontal: 8,
          paddingVertical: 5,
          position: "absolute",
        })}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "600" }}>
          © OpenStreetMap contributors
        </Text>
      </Pressable>

      <View
        testID="tracking-status-card"
        style={{
          backgroundColor: "rgba(7, 21, 32, 0.94)",
          borderColor: "rgba(234, 247, 255, 0.16)",
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
              style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}
            >
              {tracking.title}
            </Text>
            <Text
              selectable
              style={{ color: "#BFD2DD", fontSize: 13, lineHeight: 18 }}
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
