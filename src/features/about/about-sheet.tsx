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
  useWindowDimensions,
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
const CLOSE_DURATION_MS = 220;

function open(url: string) {
  void Linking.openURL(url);
}

export function AboutSheet({ colors, onClose, showOpenMapTiles, visible }: AboutSheetProps) {
  const insets = useSafeAreaInsets();
  // The sheet starts below the screen, so it slides up while the backdrop fades in.
  const offscreenY = useWindowDimensions().height;
  const [dragY] = useState(() => new Animated.Value(offscreenY));
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  // Stays mounted after `visible` turns false until the sheet has slid away.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      dragY.setValue(offscreenY);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(dragY, { bounciness: 0, toValue: 0, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { duration: 200, toValue: 1, useNativeDriver: true }),
      ]).start();
      return;
    }
    // Slide away from wherever the sheet is, including mid-drag.
    const close = Animated.parallel([
      Animated.timing(dragY, { duration: CLOSE_DURATION_MS, toValue: offscreenY, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { duration: CLOSE_DURATION_MS, toValue: 0, useNativeDriver: true }),
    ]);
    close.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => close.stop();
  }, [backdropOpacity, dragY, offscreenY, visible]);

  const panResponder = useMemo(() => {
    const settle = () =>
      Animated.spring(dragY, { bounciness: 0, toValue: 0, useNativeDriver: true }).start();
    // A clear downward drag, even one starting on text or a button.
    const isDismissDrag = (dx: number, dy: number) => dy > 8 && dy > Math.abs(dx) * 1.5;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, { dx, dy }) => isDismissDrag(dx, dy),
      onMoveShouldSetPanResponderCapture: (_event, { dx, dy }) => isDismissDrag(dx, dy),
      onPanResponderMove: (_event, { dy }) => dragY.setValue(Math.max(0, dy)),
      onPanResponderRelease: (_event, { dy, vy }) => {
        if (dy > DISMISS_DISTANCE || vy > 1) {
          onClose();
        } else {
          settle();
        }
      },
      onPanResponderTerminate: settle,
      onPanResponderTerminationRequest: () => false,
    });
  }, [dragY, onClose]);

  const link = { color: colors.secondaryText, fontWeight: "600" } as const;

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <Animated.View style={{ flex: 1, opacity: backdropOpacity }}>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          testID="about-backdrop"
        />
      </Animated.View>
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
          <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
            Made by someone who travels too much and likes progress bars a little
            too much. Every street you walk clears more fog, and every country
            counts.
          </Text>
          <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
            Your map lives only on your phone. No accounts, no tracking, no one
            watching. Enjoying it? A coffee keeps me going.
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
