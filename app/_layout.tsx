import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";

import { AppearanceProvider, useAppearance } from "@/src/features/appearance/appearance-provider";

export default function RootLayout() {
  return (
    <AppearanceProvider>
      <AppNavigator />
    </AppearanceProvider>
  );
}

function AppNavigator() {
  const { resolvedAppearance } = useAppearance();
  const dark = resolvedAppearance === "dark";
  const backgroundColor = dark ? "#071520" : "#F3F6F5";
  const foregroundColor = dark ? "#F2FCF9" : "#14252F";
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor },
          headerShown: false,
          headerStyle: { backgroundColor },
          headerTintColor: foregroundColor,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings" }} />
        <Stack.Screen
          name="countries"
          options={{
            presentation: "formSheet",
            title: "Your countries",
            headerShown: true,
            headerStyle: { backgroundColor },
            headerTintColor: foregroundColor,
            contentStyle: { backgroundColor },
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.65, 1],
          }}
        />
      </Stack>
    </>
  );
}
