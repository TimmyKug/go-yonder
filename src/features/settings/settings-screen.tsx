import { router } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppearancePreference } from "@/src/data/appearance-preference";
import { BackupStageError, describeBackupCause, isBackupCancellation } from "@/src/data/backup-failure";
import { importYonderBackup } from "@/src/data/import-yonder-backup";
import { exportYonderBackup } from "@/src/data/yonder-backup";
import { recordDiagnostic } from "@/src/diagnostics/diagnostics";
import { useAppearance } from "@/src/features/appearance/appearance-provider";

export function SettingsScreen() {
  const { appearance, resolvedAppearance, setAppearance } = useAppearance();
  const dark = resolvedAppearance === "dark";
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const foreground = dark ? "#F1F5F9" : "#14252F";
  const secondary = dark ? "#A7B6C2" : "#536774";
  const surface = dark ? "#152A38" : "#FFFFFF";
  const selectedSurface = dark ? "#284658" : "#DCEAE6";

  async function chooseAppearance(next: AppearancePreference) {
    try {
      await setAppearance(next);
    } catch {
      Alert.alert("Appearance not saved", "Try choosing the appearance again.");
    }
  }

  async function runBackup(kind: "export" | "import") {
    if (pending.current) return;
    pending.current = true;
    setBusy(kind);
    try {
      if (kind === "export") {
        const result = await exportYonderBackup();
        Alert.alert("Backup saved", `Your Yonder data was saved as ${result.fileName}.`);
      } else {
        const result = await importYonderBackup();
        if (result) Alert.alert("Backup imported", `${result.addedCount} new tiles added. Your existing unlocks are preserved.`);
      }
    } catch (error: unknown) {
      if (isBackupCancellation(error)) return;
      const stage = error instanceof BackupStageError ? error.stage : "unknown step";
      const reason = error instanceof BackupStageError ? error.reason : describeBackupCause(error);
      recordDiagnostic("backup-error", { operation: kind, stage, reason });
      Alert.alert(kind === "import" ? "Backup not imported" : "Backup not saved",
        `${kind === "import" ? "Your existing unlocks are unchanged." : "Try choosing a writable folder."}\n\nStep: ${stage}\nReason: ${reason}`);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: dark ? "#071520" : "#F3F6F5" }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 20 }}>
      <Text selectable style={{ color: secondary, fontSize: 16, lineHeight: 24 }}>Keep your exploration with you. Importing a Yonder backup adds its tiles to your map and preserves everything you have already unlocked.</Text>
      <View style={{ gap: 10 }}>
        <Text style={{ color: foreground, fontSize: 18, fontWeight: "600" }}>Appearance</Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
          {(["system", "light", "dark"] as const).map((option) => {
            const selected = appearance === option;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option}
                onPress={() => void chooseAppearance(option)}
                style={({ pressed }) => ({
                  flex: 1, alignItems: "center", borderRadius: 14, borderCurve: "continuous",
                  backgroundColor: selected ? selectedSurface : surface,
                  borderWidth: 1, borderColor: selected ? (dark ? "#6CA69A" : "#789B91") : (dark ? "#28404E" : "#D8E0DE"),
                  paddingHorizontal: 10, paddingVertical: 12, opacity: pressed ? 0.65 : 1,
                })}
              >
                <Text style={{ color: foreground, fontSize: 15, fontWeight: selected ? "700" : "500", textTransform: "capitalize" }}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        {([ ["export", "Save backup", "Save a copy of your Yonder data to a folder you choose."], ["import", "Import backup", "Choose a yonder-backup.db file. Repeated imports never duplicate tiles."] ] as const).map(([kind, title, detail]) => (
          <Pressable key={kind} accessibilityRole="button" accessibilityState={{ disabled: busy !== null }} disabled={busy !== null} testID={`${kind}-backup`} onPress={() => void runBackup(kind)} style={({ pressed }) => ({ backgroundColor: surface, borderRadius: 18, borderCurve: "continuous", padding: 20, gap: 8, opacity: pressed || (busy !== null && busy !== kind) ? 0.5 : 1 })}>
            <Text style={{ color: foreground, fontSize: 18, fontWeight: "600" }}>{title}</Text>
            <Text style={{ color: secondary, fontSize: 15, lineHeight: 22 }}>{detail}</Text>
            {busy === kind && <ActivityIndicator accessibilityLabel={kind === "import" ? "Importing backup" : "Saving backup"} color={foreground} />}
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings().catch(() => Alert.alert("Settings unavailable", "Open your device settings to manage Yonder permissions."))} style={{ paddingVertical: 16, minHeight: 48 }}>
        <Text style={{ color: foreground, fontSize: 17, fontWeight: "600" }}>Location permissions</Text>
        <Text style={{ color: secondary, marginTop: 6 }}>Open Yonder in system settings</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/diagnostics")} style={{ paddingVertical: 16, minHeight: 48 }}>
        <Text style={{ color: foreground, fontSize: 17, fontWeight: "600" }}>Diagnostics</Text>
        <Text style={{ color: secondary, marginTop: 6 }}>See how location tracking behaved, without any locations</Text>
      </Pressable>
    </ScrollView>
  );
}
