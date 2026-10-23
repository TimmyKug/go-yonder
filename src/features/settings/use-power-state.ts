import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { readPowerState } from "@/src/device-health/device-health";
import type { PowerState } from "@/src/domain/device-health";

/** The battery state, read again whenever the app returns to the foreground. */
export function usePowerState(): PowerState | null {
  const [state, setState] = useState(readPowerState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setState(readPowerState());
    });
    return () => subscription.remove();
  }, []);
  return state;
}
