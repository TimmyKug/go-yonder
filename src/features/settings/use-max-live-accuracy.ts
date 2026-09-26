import { useSyncExternalStore } from "react";

import {
  readMaxLiveAccuracyM,
  subscribeMaxLiveAccuracyM,
} from "@/src/data/accuracy-preference";

export function useMaxLiveAccuracyM() {
  return useSyncExternalStore(subscribeMaxLiveAccuracyM, readMaxLiveAccuracyM);
}
