import { useSyncExternalStore } from "react";

import {
  readFolderBackupSettings,
  subscribeFolderBackupSettings,
} from "@/src/data/folder-backup";

export function useFolderBackupSettings() {
  return useSyncExternalStore(subscribeFolderBackupSettings, readFolderBackupSettings);
}
