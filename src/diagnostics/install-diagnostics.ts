// Imported first by the entry module so the process start is recorded before
// the background task or the router loads.
import { installDiagnostics, recordConfirmedDiagnostic, recordDiagnostic } from "./diagnostics";
import { installJsErrorRecorder } from "./js-errors";

import { describeBackupCause } from "@/src/data/backup-failure";
import { setDatabaseReconnectListener } from "@/src/data/database";
import {
  describePowerForDiagnostics,
  forgetFatalJsError,
  keepFatalJsError,
  markJsStart,
  recordCrashes,
  recordCrashLog,
  recordKeptFatalJsError,
  recordProcessExits,
  recordTaskRestores,
} from "@/src/device-health/device-health";

const previousJsStartMs = markJsStart();
installDiagnostics(describePowerForDiagnostics());
if (typeof ErrorUtils !== "undefined") {
  installJsErrorRecorder(ErrorUtils, {
    record: (detail) => recordConfirmedDiagnostic("js-error", detail),
    keepFatal: keepFatalJsError,
    forgetFatal: forgetFatalJsError,
  });
}
setDatabaseReconnectListener((error) => {
  recordDiagnostic("database-reopen", { reason: describeBackupCause(error) });
});
void (async () => {
  await recordProcessExits();
  await recordCrashes(previousJsStartMs);
  await recordCrashLog();
  await recordKeptFatalJsError();
  await recordTaskRestores();
})();
