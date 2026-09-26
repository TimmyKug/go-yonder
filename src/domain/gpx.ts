/** A GPS point as written to or read from a GPX file. */
export type GpxPoint = {
  latitude: number;
  longitude: number;
  /** Milliseconds since the epoch. */
  recordedAtMs: number;
  horizontalAccuracyM?: number;
};

export type ParsedGpxPoint = {
  latitude: number;
  longitude: number;
  /** An ISO 8601 timestamp with a zone, as the sample contract requires. */
  recordedAt: string;
  horizontalAccuracyM?: number;
};

export type ParsedGpx = {
  points: ParsedGpxPoint[];
  /** Points without a readable time; a tile needs to know when it was visited. */
  skippedWithoutTimeCount: number;
  /** Points without a readable coordinate. */
  skippedInvalidCount: number;
};

export const YONDER_GPX_NAMESPACE = "https://github.com/TimmyKug/go-yonder/gpx/1";

// Points further apart in time start a new track segment, so viewers do not
// draw straight lines across gaps in recording.
const SEGMENT_GAP_MS = 60 * 60 * 1000;

/** GPX 1.1 with one track; points must be sorted by time. */
export function formatGpx(points: readonly GpxPoint[]): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    `<gpx version="1.1" creator="Yonder" xmlns="http://www.topografix.com/GPX/1/1" xmlns:yonder="${YONDER_GPX_NAMESPACE}">\n`,
    "<trk><name>Yonder GPS points</name>\n",
  ];
  let previousMs: number | undefined;
  for (const point of points) {
    if (previousMs === undefined || point.recordedAtMs - previousMs > SEGMENT_GAP_MS) {
      if (previousMs !== undefined) parts.push("</trkseg>\n");
      parts.push("<trkseg>\n");
    }
    previousMs = point.recordedAtMs;
    const accuracy =
      point.horizontalAccuracyM === undefined
        ? ""
        : `<extensions><yonder:accuracy>${formatNumber(point.horizontalAccuracyM, 1)}</yonder:accuracy></extensions>`;
    parts.push(
      `<trkpt lat="${formatNumber(point.latitude, 7)}" lon="${formatNumber(point.longitude, 7)}">` +
        `<time>${new Date(point.recordedAtMs).toISOString()}</time>${accuracy}</trkpt>\n`,
    );
  }
  if (previousMs !== undefined) parts.push("</trkseg>\n");
  parts.push("</trk>\n</gpx>\n");
  return parts.join("");
}

function formatNumber(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

// Track, route and waypoint elements, with or without a namespace prefix,
// either self-closing or with child elements.
const POINT_PATTERN =
  /<((?:[\w.-]+:)?(?:trkpt|rtept|wpt))\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
const TIME_PATTERN = /<(?:[\w.-]+:)?time\s*>\s*([^<]*?)\s*<\/(?:[\w.-]+:)?time\s*>/;
const ACCURACY_PATTERN = /<(?:[\w.-]+:)?accuracy\s*>\s*([^<]*?)\s*<\/(?:[\w.-]+:)?accuracy\s*>/;
const LOCAL_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? (match[1] ?? match[2]) : undefined;
}

function parseCoordinate(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reads the points of a GPX file from any app. It is a tolerant scanner rather
 * than a validating XML parser: unknown elements and extensions are ignored.
 */
export function parseGpx(text: string): ParsedGpx {
  const points: ParsedGpxPoint[] = [];
  let skippedWithoutTimeCount = 0;
  let skippedInvalidCount = 0;

  const pattern = new RegExp(POINT_PATTERN.source, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    const latitude = parseCoordinate(attribute(attributes, "lat"));
    const longitude = parseCoordinate(attribute(attributes, "lon"));
    if (latitude === undefined || longitude === undefined) {
      skippedInvalidCount += 1;
      continue;
    }
    const time = TIME_PATTERN.exec(body)?.[1];
    if (!time) {
      skippedWithoutTimeCount += 1;
      continue;
    }
    // GPX times are UTC; some apps leave out the zone.
    const recordedAt = LOCAL_TIME_PATTERN.test(time) ? `${time}Z` : time;
    const accuracy = parseCoordinate(ACCURACY_PATTERN.exec(body)?.[1]);
    points.push({
      latitude,
      longitude,
      recordedAt,
      ...(accuracy !== undefined && accuracy >= 0 ? { horizontalAccuracyM: accuracy } : {}),
    });
  }

  return { points, skippedWithoutTimeCount, skippedInvalidCount };
}

export function looksLikeGpx(text: string): boolean {
  return /<(?:[\w.-]+:)?gpx[\s>]/.test(text.slice(0, 4096));
}
