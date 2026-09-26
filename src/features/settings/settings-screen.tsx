import { router } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LIVE_ACCURACY_OPTIONS_M, type LiveAccuracyOptionM } from "@/src/config/yonder-config";
import { writeMaxLiveAccuracyM } from "@/src/data/accuracy-preference";
import type { AppearancePreference } from "@/src/data/appearance-preference";
import { BackupStageError, describeBackupCause, isBackupCancellation } from "@/src/data/backup-failure";
import { exportGpx } from "@/src/data/gpx-export";
import { importLocationFile, type LocationFileImportResult } from "@/src/data/import-location-file";
import { exportYonderBackup } from "@/src/data/yonder-backup";
import { recordDiagnostic } from "@/src/diagnostics/diagnostics";
import { useAppearance } from "@/src/features/appearance/appearance-provider";
import { ChoiceRow, type ChoiceColors } from "@/src/features/settings/choice-row";
import { FolderBackupSection } from "@/src/features/settings/folder-backup-section";
import { useMaxLiveAccuracyM } from "@/src/features/settings/use-max-live-accuracy";

type DataAction = "export" | "gpx" | "import";

const DATA_ACTIONS: readonly (readonly [DataAction, string, string])[] = [
  ["export", "Save backup", "Save a copy of all your Yonder data to a folder you choose."],
  ["gpx", "Export GPS points", "Save every recorded GPS point as a GPX track that other map apps can open."],
  ["import", "Import", "Choose a Yonder backup or a GPX file from any app. Repeated imports never duplicate tiles or points."],
];

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function describeImport(result: LocationFileImportResult): [string, string] {
  if (result.kind === "backup") {
    const lines = [
      `${plural(result.addedCount, "new tile")} and ${plural(result.addedSampleCount, "GPS point")} added. Everything already on this device is preserved.`,
    ];
    if (result.skippedSampleCount > 0) {
      lines.push(`${plural(result.skippedSampleCount, "GPS point")} could not be read and were skipped.`);
    }
    return ["Backup imported", lines.join("\n")];
  }
  const lines = [`${plural(result.addedTileCount, "new tile")} and ${plural(result.addedPointCount, "GPS point")} added.`];
  if (result.alreadyStoredCount > 0) lines.push(`${plural(result.alreadyStoredCount, "point")} were already saved.`);
  if (result.skippedCount > 0) lines.push(`${plural(result.skippedCount, "point")} without a valid time or position were skipped.`);
  return ["GPX imported", lines.join("\n")];
}

export function SettingsScreen() {
  const { appearance, resolvedAppearance, setAppearance } = useAppearance();
  const dark = resolvedAppearance === "dark";
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<DataAction | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const pending = useRef(false);
  const foreground = dark ? "#F1F5F9" : "#14252F";
  const secondary = dark ? "#A7B6C2" : "#536774";
  const surface = dark ? "#152A38" : "#FFFFFF";
  const selectedSurface = dark ? "#284658" : "#DCEAE6";
  const maxAccuracyM = useMaxLiveAccuracyM();
  const choiceColors: ChoiceColors = {
    border: dark ? "#28404E" : "#D8E0DE",
    foreground,
    selectedBorder: dark ? "#6CA69A" : "#789B91",
    selectedSurface,
    surface,
  };

  async function chooseAppearance(next: AppearancePreference) {
    try {
      await setAppearance(next);
    } catch {
      Alert.alert("Appearance not saved", "Try choosing the appearance again.");
    }
  }

  async function chooseAccuracy(next: LiveAccuracyOptionM) {
    try {
      await writeMaxLiveAccuracyM(next);
    } catch {
      Alert.alert("Accuracy not saved", "Try choosing the accuracy again.");
    }
  }

  async function runBackup(kind: DataAction) {
    if (pending.current) return;
    pending.current = true;
    setBusy(kind);
    try {
      if (kind === "export") {
        const result = await exportYonderBackup();
        Alert.alert("Backup saved", `Your Yonder data was saved as ${result.fileName}.`);
      } else if (kind === "gpx") {
        const result = await exportGpx();
        Alert.alert("GPS points exported", `${plural(result.pointCount, "GPS point")} saved as ${result.fileName}.`);
      } else {
        const result = await importLocationFile((processed, total) =>
          setImportProgress(`Adding GPS points… ${Math.round((processed / total) * 100)}%`));
        if (result) Alert.alert(...describeImport(result));
      }
    } catch (error: unknown) {
      if (isBackupCancellation(error)) return;
      const stage = error instanceof BackupStageError ? error.stage : "unknown step";
      const reason = error instanceof BackupStageError ? error.reason : describeBackupCause(error);
      recordDiagnostic("backup-error", { operation: kind, stage, reason });
      Alert.alert(kind === "import" ? "Not imported" : kind === "gpx" ? "GPS points not exported" : "Backup not saved",
        `${kind === "import" ? "A backup changes nothing when it fails. A GPX import keeps the points added before the error; importing it again continues without duplicates." : "Try choosing a writable folder."}\n\nStep: ${stage}\nReason: ${reason}`);
    } finally {
      pending.current = false;
      setBusy(null);
      setImportProgress(null);
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: dark ? "#071520" : "#F3F6F5" }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 20 }}>
      <Text selectable style={{ color: secondary, fontSize: 16, lineHeight: 24 }}>Keep your exploration with you. Importing a backup or GPX file adds its tiles and GPS points and preserves everything already on this device.</Text>
      <View style={{ gap: 10 }}>
        <Text style={{ color: foreground, fontSize: 18, fontWeight: "600" }}>Appearance</Text>
        <ChoiceRow
          colors={choiceColors}
          onChoose={(option) => void chooseAppearance(option)}
          options={(["system", "light", "dark"] as const).map((option) => ({
            label: option[0]!.toUpperCase() + option.slice(1),
            value: option,
          }))}
          selected={appearance}
        />
      </View>
      <View style={{ gap: 10 }}>
        <Text style={{ color: foreground, fontSize: 18, fontWeight: "600" }}>GPS accuracy needed</Text>
        <ChoiceRow
          colors={choiceColors}
          onChoose={(option) => void chooseAccuracy(option)}
          options={LIVE_ACCURACY_OPTIONS_M.map((option) => ({ label: `${option} m`, value: option }))}
          selected={maxAccuracyM}
          testIDPrefix="accuracy"
        />
        <Text selectable style={{ color: secondary, fontSize: 15, lineHeight: 22 }}>
          Readings less accurate than this never unlock tiles. A higher limit unlocks more
          indoors and between tall buildings, but can now and then unlock a tile next to
          where you were. Tiles already unlocked are kept.
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {DATA_ACTIONS.map(([kind, title, detail]) => (
          <Pressable key={kind} accessibilityRole="button" accessibilityState={{ disabled: busy !== null }} disabled={busy !== null} testID={`${kind}-backup`} onPress={() => void runBackup(kind)} style={({ pressed }) => ({ backgroundColor: surface, borderRadius: 18, borderCurve: "continuous", padding: 20, gap: 8, opacity: pressed || (busy !== null && busy !== kind) ? 0.5 : 1 })}>
            <Text style={{ color: foreground, fontSize: 18, fontWeight: "600" }}>{title}</Text>
            <Text style={{ color: secondary, fontSize: 15, lineHeight: 22 }}>{detail}</Text>
            {busy === kind && <ActivityIndicator accessibilityLabel={kind === "import" ? "Importing" : "Saving"} color={foreground} />}
            {busy === kind && kind === "import" && importProgress && <Text style={{ color: secondary, fontSize: 14 }}>{importProgress}</Text>}
          </Pressable>
        ))}
      </View>
      {/* Android keeps access to a chosen folder; iOS would need security-scoped bookmarks. */}
      {Platform.OS === "android" && (
        <FolderBackupSection
          colors={{
            accent: dark ? "#6CD4BD" : "#1F7A68",
            choice: { ...choiceColors, surface: dark ? "#0E2230" : "#F3F6F5" },
            foreground,
            secondary,
            surface,
            warning: dark ? "#F5B971" : "#A35B00",
          }}
        />
      )}
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
