import Constants from "expo-constants";
import { useEffect, useMemo, useState } from "react";
import {
  Animated,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BUY_ME_A_COFFEE_URL,
  OPENFREEMAP_URL,
  OPENMAPTILES_URL,
  OPENSTREETMAP_COPYRIGHT_URL,
  SOURCE_CODE_URL,
} from "@/src/config/map-config";

export type AboutSheetColors = {
  accent: string;
  accentText: string;
  border: string;
  muted: string;
  secondaryText: string;
  surface: string;
  text: string;
};

type AboutSheetProps = {
  colors: AboutSheetColors;
  onClose: () => void;
  /** False when a custom map style replaces OpenFreeMap. */
  showOpenMapTiles: boolean;
  visible: boolean;
};

// Dragging the sheet down further than this closes it.
const DISMISS_DISTANCE = 80;
// Start below the screen so the sheet slides up while the backdrop fades in.
const OFFSCREEN_Y = 800;

function open(url: string) {
  void Linking.openURL(url);
}

export function AboutSheet({ colors, onClose, showOpenMapTiles, visible }: AboutSheetProps) {
  const insets = useSafeAreaInsets();
  const [dragY] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    dragY.setValue(OFFSCREEN_Y);
    Animated.spring(dragY, {
      bounciness: 0,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }, [dragY, visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, { dx, dy }) =>
          dy > 6 && Math.abs(dy) > Math.abs(dx),
        onPanResponderMove: (_event, { dy }) => dragY.setValue(Math.max(0, dy)),
        onPanResponderRelease: (_event, { dy, vy }) => {
          if (dy > DISMISS_DISTANCE || vy > 1) {
            onClose();
          } else {
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
          }
        },
      }),
    [dragY, onClose],
  );

  const link = { color: colors.secondaryText, fontWeight: "600" } as const;

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        testID="about-backdrop"
      />
      <Animated.View
        {...panResponder.panHandlers}
        accessibilityViewIsModal
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderCurve: "continuous",
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTopWidth: 1,
          bottom: 0,
          gap: 16,
          left: 0,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 22,
          paddingTop: 10,
          position: "absolute",
          right: 0,
          transform: [{ translateY: dragY }],
        }}
        testID="about-sheet"
      >
        <View
          style={{
            alignSelf: "center",
            backgroundColor: colors.border,
            borderRadius: 2,
            height: 4,
            marginBottom: 4,
            width: 36,
          }}
        />

        <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
          <Image
            accessibilityIgnoresInvertColors
            source={require("@/assets/about-icon.png")}
            style={{ borderRadius: 12, height: 48, width: 48 }}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>
              Yonder
            </Text>
            <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2 }}>
              Version {Constants.expoConfig?.version ?? "unknown"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={{ paddingHorizontal: 4, paddingVertical: 8 }}
            testID="about-close"
          >
            <Text style={{ color: colors.secondaryText, fontSize: 15, fontWeight: "600" }}>
              Close
            </Text>
          </Pressable>
        </View>

        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
            I made Yonder because I wanted to see everywhere I&apos;ve actually been,
            without handing my location history to anyone.
          </Text>
          <Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
            It&apos;s free, open source, and everything stays on your phone. If you
            enjoy it, a coffee keeps me going.
          </Text>
        </View>

        <Pressable
          accessibilityHint="Opens Buy Me a Coffee in your browser"
          accessibilityRole="link"
          onPress={() => open(BUY_ME_A_COFFEE_URL)}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: colors.accent,
            borderCurve: "continuous",
            borderRadius: 14,
            height: 50,
            justifyContent: "center",
            opacity: pressed ? 0.8 : 1,
          })}
          testID="buy-me-a-coffee"
        >
          <Text style={{ color: colors.accentText, fontSize: 16, fontWeight: "700" }}>
            ☕ Buy me a coffee
          </Text>
        </Pressable>

        <View style={{ backgroundColor: colors.border, height: 1 }} />

        <Text
          accessibilityLabel="Map attribution"
          style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}
          testID="map-attribution"
        >
          Map data{" "}
          <Text accessibilityRole="link" onPress={() => open(OPENSTREETMAP_COPYRIGHT_URL)} style={link}>
            © OpenStreetMap contributors
          </Text>
          {showOpenMapTiles ? (
            <>
              {" · "}Map style{" "}
              <Text accessibilityRole="link" onPress={() => open(OPENMAPTILES_URL)} style={link}>
                © OpenMapTiles
              </Text>
              {" via "}
              <Text accessibilityRole="link" onPress={() => open(OPENFREEMAP_URL)} style={link}>
                OpenFreeMap
              </Text>
            </>
          ) : null}
          {" · Country borders: Natural Earth\n"}
          <Text accessibilityRole="link" onPress={() => open(SOURCE_CODE_URL)} style={link}>
            Source code on GitHub
          </Text>
          {" · MIT License"}
        </Text>
      </Animated.View>
    </Modal>
  );
}
