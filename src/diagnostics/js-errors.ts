import { describeBackupCause } from "@/src/data/backup-failure";

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;

export type GlobalErrorUtils = {
  getGlobalHandler(): ErrorHandler;
  setGlobalHandler(handler: ErrorHandler): void;
};

export type JsErrorDetail = Record<string, string | boolean>;

export type JsErrorSinks = {
  /** Writes the event; resolves to whether it reached the database. */
  record(detail: JsErrorDetail): Promise<boolean>;
  /** Keeps a fatal error synchronously, in case the process dies before the write. */
  keepFatal(detail: JsErrorDetail): void;
  /** Drops the kept fatal error once its event is saved. */
  forgetFatal(): void;
};

/** How long a fatal error waits for its diagnostics event to be written. */
export const JS_ERROR_FLUSH_TIMEOUT_MS = 1_000;

/**
 * Records uncaught JavaScript errors before React Native's own handler, which
 * ends the process for a fatal one in release builds.
 */
export function installJsErrorRecorder(errorUtils: GlobalErrorUtils, sinks: JsErrorSinks): void {
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    let detail: JsErrorDetail | null = null;
    try {
      detail = {
        name: error instanceof Error ? error.name : typeof error,
        message: describeBackupCause(error),
        fatal: isFatal === true,
      };
      if (isFatal) sinks.keepFatal(detail);
    } catch {
      // Diagnostics must never disturb the code that records them.
    }
    const saved = detail
      ? sinks.record(detail).catch(() => false)
      : Promise.resolve(false);
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), JS_ERROR_FLUSH_TIMEOUT_MS);
    });
    void Promise.race([saved, timeout]).then((written) => {
      clearTimeout(timer);
      if (written) {
        try {
          sinks.forgetFatal();
        } catch {
          // The kept error is recorded again at the next start.
        }
      }
      previous(error, isFatal);
    });
  });
}
