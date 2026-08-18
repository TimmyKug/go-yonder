import { Text, View } from "react-native";

export function ScratchMapScreen() {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: "#071520",
        flex: 1,
        justifyContent: "center",
        padding: 28,
      }}
    >
      <Text
        selectable
        style={{ color: "#FFFFFF", fontSize: 24, fontWeight: "700" }}
      >
        Scratch Map is a mobile app
      </Text>
      <Text
        selectable
        style={{
          color: "#BFD2DD",
          fontSize: 15,
          lineHeight: 22,
          maxWidth: 420,
          paddingTop: 10,
          textAlign: "center",
        }}
      >
        Run the iOS or Android development build to use native maps and
        background location tracking.
      </Text>
    </View>
  );
}
