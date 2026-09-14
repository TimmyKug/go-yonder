import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings" }} />
        <Stack.Screen name="countries" options={{
          presentation: "formSheet", title: "Your countries", headerShown: true,
          headerStyle: { backgroundColor: "#071520" }, headerTintColor: "#F2FCF9",
          contentStyle: { backgroundColor: "#071520" },
          sheetGrabberVisible: true, sheetAllowedDetents: [0.65, 1],
        }} />
      </Stack>
    </>
  );
}
