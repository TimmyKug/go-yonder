import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from "react-native";

import { isBackupCancellation } from "@/src/data/backup-failure";
import {
  BACKUP_INTERVAL_OPTIONS_HOURS,
  chooseBackupFolder,
  folderDisplayName,
  runFolderBackup,
  setFolderBackupIncludesGpx,
  setFolderBackupInterval,
  turnOffFolderBackup,
} from "@/src/data/folder-backup";
import { ChoiceRow, type ChoiceColors } from "@/src/features/settings/choice-row";
import { useFolderBackupSettings } from "@/src/features/settings/use-folder-backup";

const INTERVAL_LABELS: Record<(typeof BACKUP_INTERVAL_OPTIONS_HOURS)[number], string> = {
  1: "Hourly",
  6: "6 hours",
  24: "Daily",
  168: "Weekly",
};

export type FolderBackupSectionColors = {
  accent: string;
  choice: ChoiceColors;
  foreground: string;
  secondary: string;
  surface: string;
  warning: string;
};

function formatTime(ms: number): string {
  const date = new Date(ms);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function FolderBackupSection({ colors }: { colors: FolderBackupSectionColors }) {
  const settings = useFolderBackupSettings();
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>, failureTitle: string) {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (error: unknown) {
      if (!isBackupCancellation(error)) {
        Alert.alert(failureTitle, "Try again, or choose a different folder.");
      }
    } finally {
      setBusy(false);
    }
  }

  const button = (label: string, onPress: () => void, testID: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed || busy ? 0.5 : 1 })}
      testID={testID}
    >
      <Text style={{ color: colors.accent, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderCurve: "continuous", padding: 20, gap: 10 }}>
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "600" }}>Automatic backup</Text>
      <Text style={{ color: colors.secondary, fontSize: 15, lineHeight: 22 }}>
        Regularly replace the backup in a folder you choose, after new GPS points are saved. If
        that folder syncs to a cloud service, your location history is copied there.
      </Text>

      {settings ? (
        <>
          <Text style={{ color: colors.foreground, fontSize: 15 }}>
            Saving to {folderDisplayName(settings.folderUri)}
          </Text>
          {settings.lastFailure ? (
            <Text selectable style={{ color: colors.warning, fontSize: 14, lineHeight: 20 }}>
              Last attempt failed{settings.lastAttemptAtMs ? ` (${formatTime(settings.lastAttemptAtMs)})` : ""}.
              {"\n"}Step: {settings.lastFailure.stage}{"\n"}Reason: {settings.lastFailure.reason}
            </Text>
          ) : (
            <Text style={{ color: colors.secondary, fontSize: 14 }}>
              {settings.lastSuccessAtMs ? `Last saved ${formatTime(settings.lastSuccessAtMs)}` : "Not saved yet"}
            </Text>
          )}
          <ChoiceRow
            colors={colors.choice}
            onChoose={(hours) => void setFolderBackupInterval(hours).catch(() => undefined)}
            options={BACKUP_INTERVAL_OPTIONS_HOURS.map((hours) => ({ label: INTERVAL_LABELS[hours], value: hours }))}
            selected={settings.intervalHours}
            testIDPrefix="backup-interval"
          />
          <View style={{ alignItems: "center", flexDirection: "row", gap: 12, minHeight: 44 }}>
            <Text style={{ color: colors.foreground, flex: 1, fontSize: 15 }}>
              Also save GPS points as GPX
            </Text>
            <Switch
              accessibilityLabel="Also save GPS points as GPX"
              onValueChange={(value) => void setFolderBackupIncludesGpx(value).catch(() => undefined)}
              testID="folder-backup-gpx"
              value={settings.includeGpx}
            />
          </View>
          <View style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", columnGap: 20 }}>
            {button("Save now", () => void run(() => runFolderBackup(), "Backup not saved"), "folder-backup-now")}
            {button("Change folder", () => void run(() => chooseBackupFolder(), "Folder not changed"), "folder-backup-folder")}
            {button("Turn off", () => void run(turnOffFolderBackup, "Automatic backup not turned off"), "folder-backup-off")}
            {busy && <ActivityIndicator accessibilityLabel="Saving backup" color={colors.foreground} />}
          </View>
        </>
      ) : (
        <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
          {button("Choose folder", () => void run(() => chooseBackupFolder(), "Automatic backup not set up"), "folder-backup-folder")}
          {busy && <ActivityIndicator accessibilityLabel="Saving backup" color={colors.foreground} />}
        </View>
      )}
    </View>
  );
}
