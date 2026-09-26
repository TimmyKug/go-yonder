import { Pressable, Text, View } from "react-native";

export type ChoiceColors = {
  border: string;
  foreground: string;
  selectedBorder: string;
  selectedSurface: string;
  surface: string;
};

export function ChoiceRow<T extends string | number>({ colors, onChoose, options, selected, testIDPrefix }: {
  colors: ChoiceColors;
  onChoose: (value: T) => void;
  options: readonly { label: string; value: T }[];
  selected: T;
  testIDPrefix?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
      {options.map(({ label, value }) => {
        const isSelected = value === selected;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            key={value}
            onPress={() => onChoose(value)}
            style={({ pressed }) => ({
              flex: 1, alignItems: "center", borderRadius: 14, borderCurve: "continuous",
              backgroundColor: isSelected ? colors.selectedSurface : colors.surface,
              borderWidth: 1, borderColor: isSelected ? colors.selectedBorder : colors.border,
              paddingHorizontal: 10, paddingVertical: 12, opacity: pressed ? 0.65 : 1,
            })}
            testID={testIDPrefix ? `${testIDPrefix}-${value}` : undefined}
          >
            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: isSelected ? "700" : "500" }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
