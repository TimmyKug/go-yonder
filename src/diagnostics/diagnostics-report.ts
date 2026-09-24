import type {
  DiagnosticDetail,
  DiagnosticEvent,
} from "@/src/domain/diagnostic-event";

export type DiagnosticsReportContext = Readonly<{
  appVersion: string;
  platform: string;
  generatedAtMs: number;
}>;

export function formatDiagnosticTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function formatDiagnosticDetail(detail: DiagnosticDetail): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key}=${value === null ? "null" : String(value)}`)
    .join(" ");
}

export function formatDiagnosticLine(event: DiagnosticEvent): string {
  const detail = formatDiagnosticDetail(event.detail);
  return [
    formatDiagnosticTime(event.recordedAtMs),
    `[${event.processId}]`,
    event.kind,
    detail,
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

/** Oldest first, so the shared text reads in the order things happened. */
export function formatDiagnosticsReport(
  newestFirst: readonly DiagnosticEvent[],
  context: DiagnosticsReportContext,
): string {
  const header = [
    "Yonder diagnostics",
    `App ${context.appVersion} on ${context.platform}`,
    `Generated ${formatDiagnosticTime(context.generatedAtMs)} (device local time)`,
    `${newestFirst.length} events. The bracketed ID changes whenever the app process restarts.`,
    "",
  ];
  const lines = [...newestFirst].reverse().map(formatDiagnosticLine);
  return [...header, ...lines].join("\n");
}
