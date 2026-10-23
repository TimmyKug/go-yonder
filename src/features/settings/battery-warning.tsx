import { useSyncExternalStore } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { openBatterySettings } from "@/src/device-health/device-health";
import { usePowerState } from "@/src/features/settings/use-power-state";
import { getLocationSnapshot, subscribeToLocationState } from "@/src/location";

export type BatteryWarningColors = {
  accent: string;
  foreground: string;
  secondary: string;
  surface: string;
  warning: string;
};

/** Shown while background tracking is on and Android may stop it to save battery. */
export function BatteryWarning({ colors }: { colors: BatteryWarningColors }) {
  const power = usePowerState();
  const location = useSyncExternalStore(subscribeToLocationState, getLocationSnapshot, getLocationSnapshot);
  if (!power || power.battery === "unrestricted" || location.trackingMode !== "background") return null;

  const restricted = power.battery === "restricted";
  const open = () => {
    if (!openBatterySettings()) {
      Alert.alert("Settings unavailable", "Open Yonder in system settings and set its battery use to Unrestricted.");
    }
  };

  return (
    <View testID="battery-warning" style={{ backgroundColor: colors.surface, borderRadius: 18, borderCurve: "continuous", padding: 20, gap: 10 }}>
      <Text style={{ color: colors.warning, fontSize: 18, fontWeight: "600" }}>Battery saving can stop tracking</Text>
      <Text selectable style={{ color: colors.secondary, fontSize: 15, lineHeight: 22 }}>
        {restricted
          ? "Yonder's battery use is Restricted, so Android stops it in the background and places you visit are not recorded."
          : "Yonder's battery use is Optimized, so Android can stop it in the background and places you visit are not recorded until you open the app."}
        {" "}Set it to Unrestricted to keep tracking reliable.
      </Text>
      <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.5 : 1 })} testID="battery-warning-open">
        <Text style={{ color: colors.accent, fontSize: 16, fontWeight: "600" }}>
          {restricted ? "Open battery settings" : "Allow unrestricted battery use"}
        </Text>
      </Pressable>
    </View>
  );
}
