import Storage from "expo-sqlite/kv-store";

export type AppearancePreference = "system" | "light" | "dark";

const APPEARANCE_KEY = "appearance";

function isAppearancePreference(value: string | null): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readAppearancePreference(): AppearancePreference {
  try {
    const value = Storage.getItemSync(APPEARANCE_KEY);
    return isAppearancePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export async function writeAppearancePreference(preference: AppearancePreference): Promise<void> {
  await Storage.setItemAsync(APPEARANCE_KEY, preference);
}
