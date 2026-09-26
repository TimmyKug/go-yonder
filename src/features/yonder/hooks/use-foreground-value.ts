import { useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

function subscribeToAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

function isInBackground() {
  return AppState.currentState === "background";
}

/**
 * Returns `value`, except while the app is in the background, when it keeps
 * returning the last value seen before. Background location batches still
 * update app state, and passing every change on to the native map would make
 * MapLibre re-parse its sources for a map nobody can see.
 */
export function useForegroundValue<T>(value: T): T {
  const inBackground = useSyncExternalStore(subscribeToAppState, isInBackground);
  const [held, setHeld] = useState(value);

  if (!inBackground && held !== value) {
    setHeld(value);
  }

  return inBackground ? held : value;
}
