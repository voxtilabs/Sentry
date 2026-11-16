import { haversineM } from './haversine';

export interface TrackSample {
  recordedAt: Date;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

/** Only consecutive, usable measurements form a measured segment. Raw evidence stays intact. */
export function splitTrack<T extends TrackSample>(points: readonly T[], rules: {
  maxAccuracyM: number; maxGapSeconds: number; maxSpeedKmh: number;
}): T[][] {
  const segments: T[][] = [];
  let previous: T | null = null;
  let interrupted = true;
  for (const point of [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
    const time = point.recordedAt.getTime();
    if (!Number.isFinite(time) || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180 ||
      (point.accuracyM !== null && (!Number.isFinite(point.accuracyM) || point.accuracyM > rules.maxAccuracyM))) {
      interrupted = true;
      continue;
    }
    const seconds = previous ? (time - previous.recordedAt.getTime()) / 1000 : 0;
    if (previous && seconds <= 0) continue;
    const gap = previous !== null && seconds >= rules.maxGapSeconds;
    if (previous && !gap && haversineM(previous.latitude, previous.longitude, point.latitude, point.longitude) / seconds * 3.6 > rules.maxSpeedKmh) {
      interrupted = true;
      continue;
    }
    if (interrupted || gap || !previous) segments.push([]);
    segments[segments.length - 1]!.push(point);
    previous = point;
    interrupted = false;
  }
  return segments;
}

export function measuredDistance(segments: readonly (readonly TrackSample[])[]): number {
  let distance = 0;
  for (const segment of segments) for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1]!, b = segment[i]!;
    distance += haversineM(a.latitude, a.longitude, b.latitude, b.longitude);
  }
  return distance;
}
