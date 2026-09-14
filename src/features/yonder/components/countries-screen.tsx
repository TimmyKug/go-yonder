import { Stack, router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCountrySummary } from "../hooks/use-country-summary";

import { formatUncoveredPercent } from "@/src/domain/country-coverage";

export function CountriesScreen() {
  const { countries, loading, error, refresh } = useCountrySummary(true);
  const [search, setSearch] = useState("");
  const insets = useSafeAreaInsets();
  const visible = countries?.filter(({ name }) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  return (
    <>
      <Stack.Screen options={{ headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Close countries" onPress={() => router.back()} style={{ padding: 12 }}>
          <Text style={{ color: "#F2FCF9", fontSize: 16 }}>Done</Text>
        </Pressable>
      ) }} />
      <FlatList
        testID="country-list"
        data={visible}
        keyExtractor={({ id }) => id}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
        style={{ flex: 1, backgroundColor: "#071520" }}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
              <Text selectable style={{ color: "#F2FCF9", fontSize: 48, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{countries?.length ?? "—"}</Text>
              <Text selectable style={{ color: "#B7C2C9", fontSize: 17 }}>{countries?.length === 1 ? "country visited" : "countries visited"}</Text>
              {loading ? <ActivityIndicator color="#B7C2C9" /> : null}
            </View>
            <Text selectable style={{ color: "#B7C2C9", fontSize: 13, lineHeight: 20 }}>
              Uncovered area is estimated from your largest explored hexes, clipped to each country. It stays the same as you zoom.
            </Text>
            <TextInput
              accessibilityLabel="Find a visited country"
              placeholder="Find a country"
              placeholderTextColor="#8D9DA7"
              value={search} onChangeText={setSearch} autoCorrect={false}
              style={{ color: "#F2FCF9", fontSize: 16, borderWidth: 1, borderColor: "#35434E", borderRadius: 16, padding: 14 }}
            />
            {error ? (
              <Pressable accessibilityRole="button" onPress={refresh} style={{ paddingVertical: 12 }}>
                <Text selectable style={{ color: "#F2FCF9" }}>{error} Tap to retry.</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: "#263741" }}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text selectable style={{ color: "#F2FCF9", fontSize: 18, fontWeight: "500" }}>{item.name}</Text>
              <Text selectable style={{ color: "#9CACB6", fontSize: 13 }}>
                First visited {new Date(item.firstSeenAtMs).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 5 }}>
              <Text selectable style={{ color: "#F2FCF9", fontSize: 19, fontWeight: "600", fontVariant: ["tabular-nums"] }}>≈ {formatUncoveredPercent(item.uncoveredPercent)}</Text>
              <Text style={{ color: "#9CACB6", fontSize: 12 }}>uncovered</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={!loading && !error ? (
          <Text selectable style={{ color: "#B7C2C9", fontSize: 16, lineHeight: 24, paddingVertical: 24 }}>
            {search ? "No visited countries match your search." : "Your countries will appear here as you explore. Import a Yonder backup in Settings to include earlier visits."}
          </Text>
        ) : null}
        ListFooterComponent={
          <Text selectable style={{ color: "#8D9DA7", fontSize: 12, lineHeight: 18, paddingTop: 24 }}>
            Saved on this device. Boundaries: Natural Earth. Territories count toward their sovereign country; Antarctica is excluded.
          </Text>
        }
      />
    </>
  );
}
