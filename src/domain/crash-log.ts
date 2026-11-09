export type CrashLogEntry = Readonly<{
  atMs: number;
  lines: readonly string[];
}>;

export const MAX_CRASH_LOG_LINES = 22;

// `logcat -v threadtime -v year`: "2026-10-25 08:02:58.950  7025  7025 E AndroidRuntime: message"
const LINE_PATTERN =
  /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3})\s+(\d+)\s+\d+\s+[A-Z]\s+(.+?)\s*: ?(.*)$/;

type ParsedLine = { atMs: number; pid: string; tag: string; message: string };

function parseLine(line: string): ParsedLine | null {
  const match = LINE_PATTERN.exec(line);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, ms, pid, tag, message] = match;
  return {
    // Logcat prints device local time.
    atMs: new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(ms),
    ).getTime(),
    pid: pid!,
    tag: tag!,
    message: message!,
  };
}

/**
 * Splits Android's crash log into one entry per `FATAL EXCEPTION`, each with
 * the lines its process and tag printed until the next crash, oldest first.
 */
export function parseCrashLog(text: string): CrashLogEntry[] {
  const entries: { atMs: number; pid: string; tag: string; lines: string[] }[] = [];
  let current: (typeof entries)[number] | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.message.startsWith("FATAL EXCEPTION")) {
      current = { atMs: line.atMs, pid: line.pid, tag: line.tag, lines: [line.message] };
      entries.push(current);
    } else if (current && line.pid === current.pid && line.tag === current.tag) {
      current.lines.push(line.message);
    }
  }

  return entries.map(({ atMs, lines }) => ({
    atMs,
    lines: lines.slice(0, MAX_CRASH_LOG_LINES).map((line) => line.trim()),
  }));
}
