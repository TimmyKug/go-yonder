// Imported first by the entry module so the process start is recorded before
// the background task or the router loads.
import { installDiagnostics, recordDiagnostic } from "./diagnostics";

import { describeBackupCause } from "@/src/data/backup-failure";
import { setDatabaseReconnectListener } from "@/src/data/database";

installDiagnostics();
setDatabaseReconnectListener((error) => {
  recordDiagnostic("database-reopen", { reason: describeBackupCause(error) });
});
