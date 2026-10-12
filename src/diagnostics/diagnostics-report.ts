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

/**
 * Android passes shared text through a binder buffer of about 1 MB, and the
 * share sheet copies it more than once, so a longer report fails silently.
 */
export const MAX_DIAGNOSTICS_REPORT_LENGTH = 60_000;

/** Oldest first, so the shared text reads in the order things happened. */
export function formatDiagnosticsReport(
  newestFirst: readonly DiagnosticEvent[],
  context: DiagnosticsReportContext,
  maxLength: number = MAX_DIAGNOSTICS_REPORT_LENGTH,
): string {
  const header = [
    "Yonder diagnostics",
    `App ${context.appVersion} on ${context.platform}`,
    `Generated ${formatDiagnosticTime(context.generatedAtMs)} (device local time)`,
  ];
  // Keep the newest events that fit, leaving room for the header and count.
  let budget = maxLength - header.join("\n").length - 200;
  const kept: string[] = [];
  for (const event of newestFirst) {
    const line = formatDiagnosticLine(event);
    budget -= line.length + 1;
    if (budget < 0) break;
    kept.push(line);
  }
  const count =
    kept.length === newestFirst.length
      ? `${newestFirst.length} events.`
      : `The newest ${kept.length} of ${newestFirst.length} events.`;
  return [
    ...header,
    `${count} The bracketed ID changes whenever the app process restarts.`,
    "",
    ...kept.reverse(),
  ].join("\n");
}
