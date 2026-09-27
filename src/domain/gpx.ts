import { LOCATION_SOURCES, type LocationSource } from "./location-sample";

/** A GPS point as written to or read from a GPX file. */
export type GpxPoint = {
  latitude: number;
  longitude: number;
  /** Milliseconds since the epoch. */
  recordedAtMs: number;
  horizontalAccuracyM?: number;
  /** How Yonder obtained the point; written so a round trip keeps it. */
  source?: LocationSource;
};

export type ParsedGpxPoint = {
  latitude: number;
  longitude: number;
  /** An ISO 8601 timestamp with a zone, as the sample contract requires. */
  recordedAt: string;
  horizontalAccuracyM?: number;
  /** Only present in files written by Yonder. */
  source?: LocationSource;
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
    const extensions =
      (point.horizontalAccuracyM === undefined
        ? ""
        : `<yonder:accuracy>${formatNumber(point.horizontalAccuracyM)}</yonder:accuracy>`) +
      (point.source === undefined ? "" : `<yonder:source>${point.source}</yonder:source>`);
    parts.push(
      `<trkpt lat="${formatNumber(point.latitude)}" lon="${formatNumber(point.longitude)}">` +
        `<time>${new Date(point.recordedAtMs).toISOString()}</time>` +
        `${extensions ? `<extensions>${extensions}</extensions>` : ""}</trkpt>\n`,
    );
  }
  if (previousMs !== undefined) parts.push("</trkseg>\n");
  parts.push("</trk>\n</gpx>\n");
  return parts.join("");
}

/**
 * The shortest decimal that reads back as exactly the same number, so a GPX
 * round trip is lossless. GPX decimals cannot use exponent notation.
 */
function formatNumber(value: number): string {
  const text = String(value);
  return /e/i.test(text) ? value.toFixed(20).replace(/\.?0+$/, "") : text;
}

const POINT_ELEMENTS = new Set(["trkpt", "rtept", "wpt"]);
const LAT_PATTERN = /(?:^|\s)lat\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const LON_PATTERN = /(?:^|\s)lon\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const TIME_PATTERN = /<(?:[\w.-]+:)?time\s*>\s*([^<]*?)\s*<\/(?:[\w.-]+:)?time\s*>/;
const ACCURACY_PATTERN = /<(?:[\w.-]+:)?accuracy\s*>\s*([^<]*?)\s*<\/(?:[\w.-]+:)?accuracy\s*>/;
const SOURCE_PATTERN = /<(?:[\w.-]+:)?source\s*>\s*([^<]*?)\s*<\/(?:[\w.-]+:)?source\s*>/;
const LOCAL_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const NAME_END = /[\s/>]/;

function attribute(attributes: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(attributes);
  return match ? (match[1] ?? match[2]) : undefined;
}

function parseCoordinate(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reads the points of a GPX file from any app. It is a tolerant scanner rather
 * than a validating XML parser: track, route and waypoint elements are found
 * with or without a namespace prefix, self-closing or with children, and
 * unknown elements and extensions are ignored. It walks the text with
 * indexOf, so large files cost little more than one pass.
 */
export function parseGpx(text: string): ParsedGpx {
  const points: ParsedGpxPoint[] = [];
  let skippedWithoutTimeCount = 0;
  let skippedInvalidCount = 0;

  let position = text.indexOf("<");
  while (position !== -1) {
    // The element name ends at whitespace, "/" or ">".
    let nameEnd = position + 1;
    while (nameEnd < text.length && !NAME_END.test(text[nameEnd]!)) nameEnd += 1;
    const name = text.slice(position + 1, nameEnd);
    const localName = name.slice(name.indexOf(":") + 1);
    if (!POINT_ELEMENTS.has(localName)) {
      position = text.indexOf("<", position + 1);
      continue;
    }

    const tagEnd = text.indexOf(">", nameEnd);
    if (tagEnd === -1) break;
    const selfClosing = text[tagEnd - 1] === "/";
    const attributes = text.slice(nameEnd, selfClosing ? tagEnd - 1 : tagEnd);
    let body = "";
    let next = tagEnd + 1;
    if (!selfClosing) {
      const close = text.indexOf(`</${name}`, next);
      if (close === -1) break;
      body = text.slice(next, close);
      next = text.indexOf(">", close) + 1;
      if (next === 0) break;
    }
    position = text.indexOf("<", next);

    const latitude = parseCoordinate(attribute(attributes, LAT_PATTERN));
    const longitude = parseCoordinate(attribute(attributes, LON_PATTERN));
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
    const source = SOURCE_PATTERN.exec(body)?.[1];
    points.push({
      latitude,
      longitude,
      recordedAt,
      ...(accuracy !== undefined && accuracy >= 0 ? { horizontalAccuracyM: accuracy } : {}),
      ...(isLocationSource(source) ? { source } : {}),
    });
  }

  return { points, skippedWithoutTimeCount, skippedInvalidCount };
}

function isLocationSource(value: string | undefined): value is LocationSource {
  return (LOCATION_SOURCES as readonly string[]).includes(value ?? "");
}

export function looksLikeGpx(text: string): boolean {
  return /<(?:[\w.-]+:)?gpx[\s>]/.test(text.slice(0, 4096));
}
