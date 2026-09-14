import { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

import { readAppearancePreference, type AppearancePreference, writeAppearancePreference } from "@/src/data/appearance-preference";

type ResolvedAppearance = "light" | "dark";
type AppearanceContextValue = {
  appearance: AppearancePreference;
  resolvedAppearance: ResolvedAppearance;
  setAppearance: (appearance: AppearancePreference) => Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

export function AppearanceProvider({ children }: PropsWithChildren) {
  const systemAppearance = useColorScheme() === "dark" ? "dark" : "light";
  const [appearance, setAppearanceState] = useState(readAppearancePreference);
  const setAppearance = useCallback(async (next: AppearancePreference) => {
    await writeAppearancePreference(next);
    setAppearanceState(next);
  }, []);
  const value = useMemo<AppearanceContextValue>(() => ({
    appearance,
    resolvedAppearance: appearance === "system" ? systemAppearance : appearance,
    setAppearance,
  }), [appearance, setAppearance, systemAppearance]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used inside AppearanceProvider");
  return context;
}
