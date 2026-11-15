// Plane geometry for the plan editor. Everything is in metres.

export interface Point {
  x: number;
  y: number;
}

/** Two points closer than this (5 mm) are the same point. */
export const MERGE_DISTANCE = 0.005;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function samePoint(a: Point, b: Point): boolean {
  return distance(a, b) < MERGE_DISTANCE;
}

/** The point of segment a-b nearest to p, how far along it is (0 at a, 1 at
 * b) and how far p is from it. */
export function projectOnSegment(
  p: Point,
  a: Point,
  b: Point,
): { point: Point; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const raw = lengthSquared === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, raw));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, distance: distance(p, point) };
}

/** Where segments a-b and c-d cross, if they do. Parallel segments never
 * cross here, even when they overlap. */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + rx * t, y: a.y + ry * t };
}

/** Shoelace area: positive when the points turn the same way as from the x
 * axis towards the y axis. */
export function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

export function polygonArea(points: readonly Point[]): number {
  return Math.abs(signedArea(points));
}

export function polygonPerimeter(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += distance(points[i], points[(i + 1) % points.length]);
  }
  return sum;
}

/** The centre of mass of a polygon; the average of its points if it has no area. */
export function polygonCentroid(points: readonly Point[]): Point {
  const area = signedArea(points);
  if (Math.abs(area) < 1e-9) {
    const n = Math.max(1, points.length);
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / n,
      y: points.reduce((sum, p) => sum + p.y, 0) / n,
    };
  }
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    x += (p.x + q.x) * cross;
    y += (p.y + q.y) * cross;
  }
  return { x: x / (6 * area), y: y / (6 * area) };
}

export function pointInPolygon(p: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Round to a multiple of step, without the 0.30000000000000004 noise. */
export function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Number((Math.round(value / step) * step).toFixed(6));
}

/** A point that is certainly inside the polygon. The centroid of an L-shaped
 * room can fall outside it; this never does. */
export function interiorPoint(points: readonly Point[]): Point {
  const centroid = polygonCentroid(points);
  if (points.length < 3 || pointInPolygon(centroid, points)) return centroid;
  // Cross the polygon along a horizontal line through the centroid and take
  // the middle of the widest stretch that is inside.
  const crossings: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.y > centroid.y !== b.y > centroid.y) {
      crossings.push(a.x + ((centroid.y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  crossings.sort((p, q) => p - q);
  let best: Point = centroid;
  let widest = 0;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i + 1] - crossings[i];
    if (width > widest) {
      widest = width;
      best = { x: (crossings[i] + crossings[i + 1]) / 2, y: centroid.y };
    }
  }
  return best;
}
