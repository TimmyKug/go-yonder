export type DiagnosticEventKind =
  | "app-state"
  | "background-batch"
  | "backup-error"
  | "folder-backup"
  | "import-finished"
  | "background-start"
  | "background-task-error"
  | "foreground-watch-start"
  | "location-update-error"
  | "map-load-error"
  | "process-start"
  | "task-reregister"
  | "tracking-state";

export type DiagnosticDetailValue = string | number | boolean | null;

export type DiagnosticDetail = Readonly<Record<string, DiagnosticDetailValue>>;

export type DiagnosticEvent = Readonly<{
  recordedAtMs: number;
  processId: string;
  kind: DiagnosticEventKind;
  detail: DiagnosticDetail;
}>;

const MAX_DETAIL_ENTRIES = 24;
const MAX_TEXT_LENGTH = 200;

// Diagnostics must never contain a location. Rejecting coordinate-like keys
// keeps a careless call site from writing one.
const FORBIDDEN_KEY_PATTERN = /lat|lon|lng|coord|cell_?id|h3|place|address/i;

export function createDiagnosticEvent(
  kind: DiagnosticEventKind,
  detail: Readonly<Record<string, unknown>>,
  recordedAtMs: number,
  processId: string,
): DiagnosticEvent {
  return Object.freeze({
    recordedAtMs,
    processId,
    kind,
    detail: sanitizeDetail(detail),
  });
}

export function sanitizeDetail(
  detail: Readonly<Record<string, unknown>>,
): DiagnosticDetail {
  const sanitized: Record<string, DiagnosticDetailValue> = {};

  for (const [key, value] of Object.entries(detail).slice(
    0,
    MAX_DETAIL_ENTRIES,
  )) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      continue;
    }

    if (typeof value === "number") {
      sanitized[key] = Number.isFinite(value) ? value : null;
    } else if (typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    } else if (typeof value === "string") {
      sanitized[key] = value.slice(0, MAX_TEXT_LENGTH);
    }
  }

  return Object.freeze(sanitized);
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_TEXT_LENGTH);
}
