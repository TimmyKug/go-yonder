import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { clearDiagnostics, listDiagnostics } from "@/src/diagnostics/diagnostics";
import {
  formatDiagnosticDetail,
  formatDiagnosticsReport,
  formatDiagnosticTime,
} from "@/src/diagnostics/diagnostics-report";
import type { DiagnosticEvent } from "@/src/domain/diagnostic-event";
import { useAppearance } from "@/src/features/appearance/appearance-provider";

const SHOWN_EVENT_LIMIT = 1_000;

export function DiagnosticsScreen() {
  const { resolvedAppearance } = useAppearance();
  const dark = resolvedAppearance === "dark";
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<DiagnosticEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const foreground = dark ? "#F1F5F9" : "#14252F";
  const secondary = dark ? "#A7B6C2" : "#536774";
  const surface = dark ? "#152A38" : "#FFFFFF";
  const background = dark ? "#071520" : "#F3F6F5";

  const [reloadToken, setReloadToken] = useState(0);
  const load = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    listDiagnostics(SHOWN_EVENT_LIMIT).then(
      (newest) => {
        if (cancelled) return;
        setEvents(newest);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function share() {
    try {
      const newest = await listDiagnostics(SHOWN_EVENT_LIMIT);
      await Share.share({
        message: formatDiagnosticsReport(newest, {
          appVersion: Constants.expoConfig?.version ?? "unknown",
          platform: `${Platform.OS} ${String(Platform.Version)}`,
          generatedAtMs: Date.now(),
        }),
      });
    } catch {
      Alert.alert("Diagnostics not shared", "Try sharing the diagnostics again.");
    }
  }

  function confirmClear() {
    Alert.alert("Clear diagnostics?", "This deletes the diagnostics log. Your map and tiles are not affected.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          void clearDiagnostics().then(load, () => Alert.alert("Diagnostics not cleared", "Try clearing the diagnostics again."));
        },
      },
    ]);
  }

  const buttonStyle = ({ pressed }: { pressed: boolean }) => ({
    flex: 1, alignItems: "center" as const, backgroundColor: surface, borderRadius: 14, borderCurve: "continuous" as const,
    paddingVertical: 12, minHeight: 48, justifyContent: "center" as const, opacity: pressed ? 0.65 : 1,
  });

  return (
    <FlatList
      data={events ?? []}
      keyExtractor={(event, index) => `${event.recordedAtMs}-${index}`}
      style={{ backgroundColor: background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 8 }}
      ListHeaderComponent={
        <View style={{ gap: 16, marginBottom: 12 }}>
          <Text selectable style={{ color: secondary, fontSize: 15, lineHeight: 22 }}>
            A log of how location tracking behaved over the last seven days, newest first. It never includes where you were and stays on this device unless you share it.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => void share()} style={buttonStyle}>
              <Text style={{ color: foreground, fontSize: 16, fontWeight: "600" }}>Share</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={load} style={buttonStyle}>
              <Text style={{ color: foreground, fontSize: 16, fontWeight: "600" }}>Refresh</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={confirmClear} style={buttonStyle}>
              <Text style={{ color: foreground, fontSize: 16, fontWeight: "600" }}>Clear</Text>
            </Pressable>
          </View>
          {failed && <Text style={{ color: secondary }}>The diagnostics log could not be read.</Text>}
          {events === null && !failed && <ActivityIndicator color={foreground} />}
          {events?.length === 0 && <Text style={{ color: secondary }}>No events recorded yet.</Text>}
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ backgroundColor: surface, borderRadius: 12, borderCurve: "continuous", padding: 12, gap: 4 }}>
          <Text selectable style={{ color: foreground, fontSize: 14, fontWeight: "600" }}>
            {item.kind}
          </Text>
          <Text selectable style={{ color: secondary, fontSize: 12, fontVariant: ["tabular-nums"] }}>
            {formatDiagnosticTime(item.recordedAtMs)} · process {item.processId}
          </Text>
          {Object.keys(item.detail).length > 0 && (
            <Text selectable style={{ color: foreground, fontSize: 13, lineHeight: 19 }}>
              {formatDiagnosticDetail(item.detail)}
            </Text>
          )}
        </View>
      )}
    />
  );
}
