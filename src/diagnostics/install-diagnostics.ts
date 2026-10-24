// Imported first by the entry module so the process start is recorded before
// the background task or the router loads.
import { flushDiagnostics, installDiagnostics, recordDiagnostic } from "./diagnostics";
import { installJsErrorRecorder } from "./js-errors";

import { describeBackupCause } from "@/src/data/backup-failure";
import { setDatabaseReconnectListener } from "@/src/data/database";
import {
  describePowerForDiagnostics,
  recordProcessExits,
  recordTaskRestores,
} from "@/src/device-health/device-health";

installDiagnostics(describePowerForDiagnostics());
recordProcessExits();
recordTaskRestores();
setDatabaseReconnectListener((error) => {
  recordDiagnostic("database-reopen", { reason: describeBackupCause(error) });
});
if (typeof ErrorUtils !== "undefined") {
  installJsErrorRecorder(
    ErrorUtils,
    (detail) => recordDiagnostic("js-error", detail),
    flushDiagnostics,
  );
}
