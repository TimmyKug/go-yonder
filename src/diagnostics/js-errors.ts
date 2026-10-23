import { describeBackupCause } from "@/src/data/backup-failure";

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;

export type GlobalErrorUtils = {
  getGlobalHandler(): ErrorHandler;
  setGlobalHandler(handler: ErrorHandler): void;
};

/** How long a fatal error waits for its diagnostics event to be written. */
export const JS_ERROR_FLUSH_TIMEOUT_MS = 1_000;

/**
 * Records uncaught JavaScript errors before React Native's own handler, which
 * ends the process for a fatal one in release builds.
 */
export function installJsErrorRecorder(
  errorUtils: GlobalErrorUtils,
  record: (detail: Record<string, string | boolean>) => void,
  flush: () => Promise<void>,
): void {
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      record({
        name: error instanceof Error ? error.name : typeof error,
        message: describeBackupCause(error),
        fatal: isFatal === true,
      });
    } catch {
      // Diagnostics must never disturb the code that records them.
    }
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, JS_ERROR_FLUSH_TIMEOUT_MS);
    });
    void Promise.race([flush().catch(() => undefined), timeout]).then(() => {
      clearTimeout(timer);
      previous(error, isFatal);
    });
  });
}
