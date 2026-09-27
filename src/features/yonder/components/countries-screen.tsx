import { Stack, router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCountrySummary } from "../hooks/use-country-summary";

import { regionCountForCountry } from "@/src/countries/country-scanner";
import { formatUncoveredPercent, type RegionVisit } from "@/src/domain/country-coverage";
import { useAppearance } from "@/src/features/appearance/appearance-provider";
import { GlobeView, type GlobeColors } from "@/src/features/globe/globe-view";

const GLOBE_COLORS: Record<"dark" | "light", GlobeColors> = {
  dark: {
    limb: "#2C3E45",
    ocean: "#0A1A22",
    land: "#1E2E36",
    landEdge: "#2C3E45",
    visited: "#29D8B5",
    visitedEdge: "#8CF2DE",
  },
  light: {
    limb: "#C3D0CC",
    ocean: "#E4EBE9",
    land: "#CBD6D2",
    landEdge: "#B0BFBA",
    visited: "#0E7C66",
    visitedEdge: "#0A5B4B",
  },
};

export function CountriesScreen() {
  const { resolvedAppearance } = useAppearance();
  const dark = resolvedAppearance === "dark";
  const colors = dark ? {
    background: "#071520", border: "#263741", foreground: "#F2FCF9", secondary: "#B7C2C9", muted: "#8D9DA7",
  } : {
    background: "#F3F6F5", border: "#D6DFDC", foreground: "#14252F", secondary: "#536774", muted: "#71808A",
  };
  const { countries, regions, loading, error, refresh } = useCountrySummary();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const globeSize = Math.min(width - 40, 320);
  const visitedIds = useMemo(
    () => new Set((countries ?? []).map(({ id }) => id)),
    [countries],
  );
  const visible = countries?.filter(({ name }) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  return (
    <>
      <Stack.Screen options={{ headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Close countries" onPress={() => router.back()} style={{ padding: 12 }}>
          <Text style={{ color: colors.foreground, fontSize: 16 }}>Done</Text>
        </Pressable>
      ) }} />
      <FlatList
        testID="country-list"
        data={visible}
        keyExtractor={({ id }) => id}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
        style={{ flex: 1, backgroundColor: colors.background }}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 16 }}>
            {countries ? (
              <View style={{ alignItems: "center", paddingBottom: 4 }}>
                <GlobeView colors={GLOBE_COLORS[dark ? "dark" : "light"]} size={globeSize} visitedIds={visitedIds} />
                <Text style={{ color: colors.muted, fontSize: 12, paddingTop: 10 }}>Drag to spin the globe</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
              <Text selectable style={{ color: colors.foreground, fontSize: 48, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{countries?.length ?? "—"}</Text>
              <Text selectable style={{ color: colors.secondary, fontSize: 17 }}>{countries?.length === 1 ? "country visited" : "countries visited"}</Text>
              {loading ? <ActivityIndicator color={colors.secondary} /> : null}
            </View>
            <Text selectable style={{ color: colors.secondary, fontSize: 13, lineHeight: 20 }}>
              Uncovered area is estimated from your largest explored hexes, clipped to each country or region. It stays the same as you zoom. Tap a country for its regions.
            </Text>
            <TextInput
              accessibilityLabel="Find a visited country"
              placeholder="Find a country"
              placeholderTextColor={colors.muted}
              value={search} onChangeText={setSearch} autoCorrect={false}
              style={{ color: colors.foreground, fontSize: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14 }}
            />
            {error ? (
              <Pressable accessibilityRole="button" onPress={refresh} style={{ paddingVertical: 12 }}>
                <Text selectable style={{ color: colors.foreground }}>{error} Tap to retry.</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const visitedRegions = regions?.get(item.id) ?? [];
          const regionTotal = regionCountForCountry(item.id);
          const isExpanded = expanded.has(item.id);
          return (
            <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded, disabled: visitedRegions.length === 0 }}
                accessibilityHint={visitedRegions.length > 0 ? "Shows the regions you visited" : undefined}
                disabled={visitedRegions.length === 0}
                onPress={() => toggle(item.id)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18, opacity: pressed ? 0.6 : 1 })}
              >
                <View style={{ flex: 1, gap: 5 }}>
                  <Text selectable style={{ color: colors.foreground, fontSize: 18, fontWeight: "500" }}>{item.name}</Text>
                  <Text selectable style={{ color: colors.secondary, fontSize: 13 }}>
                    First visited {new Date(item.firstSeenAtMs).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                    {regionTotal > 0 ? ` · ${visitedRegions.length} of ${regionTotal} ${regionTotal === 1 ? "region" : "regions"}` : ""}
                    {visitedRegions.length > 0 ? (isExpanded ? " ▴" : " ▾") : ""}
                  </Text>
                </View>
                <CoverageFigure colors={colors} pending={item.coveragePending} percent={item.uncoveredPercent} />
              </Pressable>
              {isExpanded ? visitedRegions.map((region) => (
                <RegionRow colors={colors} key={region.id} region={region} />
              )) : null}
            </View>
          );
        }}
        ListEmptyComponent={!loading && !error ? (
          <Text selectable style={{ color: colors.secondary, fontSize: 16, lineHeight: 24, paddingVertical: 24 }}>
            {search ? "No visited countries match your search." : "Your countries will appear here as you explore. Import a Yonder backup in Settings to include earlier visits."}
          </Text>
        ) : null}
        ListFooterComponent={
          <Text selectable style={{ color: colors.muted, fontSize: 12, lineHeight: 18, paddingTop: 24 }}>
            Saved on this device. Boundaries: Natural Earth; regions are its first-level divisions, which differ in size between countries. Territories count toward their sovereign country; Antarctica is excluded.
          </Text>
        }
      />
    </>
  );
}

type ListColors = { border: string; foreground: string; secondary: string; muted: string };

function CoverageFigure({ colors, pending, percent, small = false }: {
  colors: ListColors;
  pending: boolean;
  percent: number;
  small?: boolean;
}) {
  return (
    <View style={{ alignItems: "flex-end", gap: small ? 3 : 5 }}>
      <Text selectable style={{ color: colors.foreground, fontSize: small ? 16 : 19, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
        {pending ? "Calculating…" : `≈ ${formatUncoveredPercent(percent)}`}
      </Text>
      <Text style={{ color: colors.secondary, fontSize: 12 }}>
        {pending ? `${formatUncoveredPercent(percent)} so far` : "uncovered"}
      </Text>
    </View>
  );
}

function RegionRow({ colors, region }: { colors: ListColors; region: RegionVisit }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 16 }}
      testID={`region-${region.id}`}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: colors.foreground, fontSize: 16 }}>{region.name}</Text>
        <Text selectable style={{ color: colors.muted, fontSize: 12 }}>
          First visited {new Date(region.firstSeenAtMs).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
        </Text>
      </View>
      <CoverageFigure colors={colors} pending={region.coveragePending} percent={region.uncoveredPercent} small />
    </View>
  );
}
