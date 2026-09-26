import { describe, expect, it } from "vitest";

import { formatGpx, looksLikeGpx, parseGpx } from "@/src/domain/gpx";

const HOUR_MS = 60 * 60 * 1000;
const start = Date.parse("2026-03-01T08:00:00.000Z");

describe("formatGpx", () => {
  it("round-trips points, times and accuracy through parseGpx", () => {
    const points = [
      { latitude: 10.1234567, longitude: 20.7654321, recordedAtMs: start, horizontalAccuracyM: 8.25 },
      { latitude: -10.5, longitude: -20.25, recordedAtMs: start + 60_000 },
    ];
    const gpx = formatGpx(points);

    expect(looksLikeGpx(gpx)).toBe(true);
    expect(parseGpx(gpx)).toEqual({
      points: [
        { latitude: 10.1234567, longitude: 20.7654321, recordedAt: "2026-03-01T08:00:00.000Z", horizontalAccuracyM: 8.3 },
        { latitude: -10.5, longitude: -20.25, recordedAt: "2026-03-01T08:01:00.000Z" },
      ],
      skippedWithoutTimeCount: 0,
      skippedInvalidCount: 0,
    });
  });

  it("starts a new segment after a gap of more than an hour", () => {
    const gpx = formatGpx([
      { latitude: 1, longitude: 2, recordedAtMs: start },
      { latitude: 1, longitude: 2, recordedAtMs: start + HOUR_MS },
      { latitude: 1, longitude: 2, recordedAtMs: start + 3 * HOUR_MS },
    ]);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    expect(gpx.match(/<\/trkseg>/g)).toHaveLength(2);
  });

  it("writes a valid empty track when nothing is recorded", () => {
    const gpx = formatGpx([]);
    expect(gpx).toContain("<trk>");
    expect(gpx).not.toContain("<trkseg>");
    expect(parseGpx(gpx).points).toEqual([]);
  });
});

describe("parseGpx", () => {
  it("reads tracks written by a typical logging app", () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0" creator="Synthetic Logger" xmlns="http://www.topografix.com/GPX/1/0">
<trk><name>Synthetic</name><trkseg>
<trkpt lat="1.5" lon="2.5"><ele>12.0</ele><time>2026-03-01T08:00:00Z</time><course>10</course><speed>1.2</speed><src>gps</src><sat>9</sat><hdop>0.9</hdop></trkpt>
<trkpt lon='2.6' lat='1.6'>
  <time>2026-03-01T08:00:05.500Z</time>
</trkpt>
</trkseg></trk></gpx>`;
    expect(parseGpx(gpx).points).toEqual([
      { latitude: 1.5, longitude: 2.5, recordedAt: "2026-03-01T08:00:00Z" },
      { latitude: 1.6, longitude: 2.6, recordedAt: "2026-03-01T08:00:05.500Z" },
    ]);
  });

  it("reads waypoints, route points, prefixed elements and self-closing points", () => {
    const gpx = `<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1">
<gpx:wpt lat="3" lon="4"><gpx:time>2026-03-01T09:00:00+02:00</gpx:time><gpx:name>Synthetic stop</gpx:name></gpx:wpt>
<rte><rtept lat="5" lon="6"><time>2026-03-01T10:00:00Z</time></rtept></rte>
<trk><trkseg><trkpt lat="7" lon="8"/></trkseg></trk>
</gpx:gpx>`;
    expect(parseGpx(gpx)).toEqual({
      points: [
        { latitude: 3, longitude: 4, recordedAt: "2026-03-01T09:00:00+02:00" },
        { latitude: 5, longitude: 6, recordedAt: "2026-03-01T10:00:00Z" },
      ],
      skippedWithoutTimeCount: 1,
      skippedInvalidCount: 0,
    });
  });

  it("treats times without a zone as UTC and ignores unrelated elements", () => {
    const gpx = `<gpx><metadata><time>2026-01-01T00:00:00Z</time></metadata>
<trk><trkseg><trkpt lat="1" lon="1"><time>2026-03-01T08:00:00</time></trkpt></trkseg></trk></gpx>`;
    expect(parseGpx(gpx).points).toEqual([
      { latitude: 1, longitude: 1, recordedAt: "2026-03-01T08:00:00Z" },
    ]);
  });

  it("counts points without a usable coordinate", () => {
    const gpx = `<gpx><trk><trkseg>
<trkpt lat="" lon="1"><time>2026-03-01T08:00:00Z</time></trkpt>
<trkpt lat="north" lon="1"><time>2026-03-01T08:00:00Z</time></trkpt>
<trkpt lon="1"><time>2026-03-01T08:00:00Z</time></trkpt>
</trkseg></trk></gpx>`;
    expect(parseGpx(gpx)).toMatchObject({ points: [], skippedInvalidCount: 3 });
  });

  it("does not mistake other files for GPX", () => {
    expect(looksLikeGpx('{"locations": []}')).toBe(false);
    expect(looksLikeGpx("<kml></kml>")).toBe(false);
    expect(looksLikeGpx('<?xml version="1.0"?>\n<gpx version="1.1">')).toBe(true);
  });
});
