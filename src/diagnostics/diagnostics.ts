import { AppState, Platform } from "react-native";

import { getDiagnosticsRepository } from "@/src/data/diagnostics-database";
import type { DiagnosticsRepository } from "@/src/data/diagnostics-repository";
import {
  createDiagnosticEvent,
  type DiagnosticEvent,
  type DiagnosticEventKind,
} from "@/src/domain/diagnostic-event";

export type DiagnosticsRecorder = {
  record(
    kind: DiagnosticEventKind,
    detail?: Readonly<Record<string, unknown>>,
  ): void;
  flush(): Promise<void>;
  listNewest(limit: number): Promise<DiagnosticEvent[]>;
  clear(): Promise<void>;
};

export function createDiagnosticsRecorder(
  getRepository: () => Promise<DiagnosticsRepository>,
  now: () => number,
  processId: string,
): DiagnosticsRecorder {
  let queue: Promise<void> = Promise.resolve();

  function enqueue(
    operation: (repository: DiagnosticsRepository) => Promise<void>,
  ): Promise<void> {
    queue = queue
      .then(async () => operation(await getRepository()))
      .catch(() => undefined);
    return queue;
  }

  return {
    record(kind, detail = {}) {
      try {
        const event = createDiagnosticEvent(kind, detail, now(), processId);
        void enqueue((repository) => repository.record(event));
      } catch {
        // Diagnostics must never disturb the code that records them.
      }
    },

    flush() {
      return queue;
    },

    async listNewest(limit) {
      await queue;
      return (await getRepository()).listNewest(limit);
    },

    async clear() {
      await queue;
      await (await getRepository()).clear();
    },
  };
}

const processStartedAtMs = Date.now();

const recorder = createDiagnosticsRecorder(
  getDiagnosticsRepository,
  Date.now,
  processStartedAtMs.toString(36),
);

export const recordDiagnostic = recorder.record;
export const flushDiagnostics = recorder.flush;
export const listDiagnostics = recorder.listNewest;
export const clearDiagnostics = recorder.clear;

let installed = false;

/**
 * Records the process start and every app state change. Call once from the
 * entry module so headless background launches are recorded too.
 */
export function installDiagnostics(): void {
  if (installed) {
    return;
  }
  installed = true;

  recordDiagnostic("process-start", {
    appState: AppState.currentState ?? "unknown",
    platform: Platform.OS,
    osVersion: String(Platform.Version),
  });

  AppState.addEventListener("change", (state) => {
    recordDiagnostic("app-state", { state });
  });
}
