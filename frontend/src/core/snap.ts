// Where the pointer "really" is while drawing or dragging: on a corner, on a
// wall, lined up with something, or on the grid.

import { distance, projectOnSegment, roundTo, type Point } from "./geometry";
import type { Floor } from "./scene";

export type SnapKind = "vertex" | "midpoint" | "wall" | "align" | "angle" | "grid" | "none";

export interface Guide {
  from: Point;
  to: Point;
}

export interface SnapResult {
  point: Point;
  kind: SnapKind;
  /** Set when the point is an existing vertex. */
  vertexId?: string;
  /** Set when the point lies on a wall. */
  wallId?: string;
  /** Lines to draw that show what the point lined up with. */
  guides: Guide[];
}

export interface SnapOptions {
  /** How close counts, in metres: a fixed number of pixels at the current zoom. */
  tolerance: number;
  /** Grid step in metres; 0 for none. */
  grid: number;
  /** The previous point of the wall being drawn. With it, the direction snaps
   * to multiples of 45 degrees. */
  from?: Point;
  /** Vertices to ignore: the ones being dragged. */
  exclude?: ReadonlySet<string>;
  /** False turns all snapping off (Alt held). */
  enabled?: boolean;
}

const ANGLE_STEP = Math.PI / 4;
const ANGLE_TOLERANCE = (7 * Math.PI) / 180;

export function snap(point: Point, floor: Pick<Floor, "vertices" | "walls">, options: SnapOptions): SnapResult {
  if (options.enabled === false) return { point, kind: "none", guides: [] };
  const { tolerance, grid, from, exclude } = options;
  const vertices = floor.vertices.filter((vertex) => !exclude?.has(vertex.id));
  const position = new Map(vertices.map((vertex) => [vertex.id, vertex]));

  // 1. An existing corner.
  let nearest: { id: string; x: number; y: number } | undefined;
  let nearestDistance = tolerance;
  for (const vertex of vertices) {
    const d = distance(vertex, point);
    if (d <= nearestDistance) {
      nearest = vertex;
      nearestDistance = d;
    }
  }
  if (nearest) {
    return {
      point: { x: nearest.x, y: nearest.y },
      kind: "vertex",
      vertexId: nearest.id,
      guides: [],
    };
  }

  // 2. A wall: its middle if that is close, otherwise the nearest point on it.
  let onWall: { id: string; point: Point; distance: number; middle: boolean } | undefined;
  for (const wall of floor.walls) {
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!a || !b) continue;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const toMiddle = distance(middle, point);
    if (toMiddle <= tolerance && (!onWall || !onWall.middle || toMiddle < onWall.distance)) {
      onWall = { id: wall.id, point: middle, distance: toMiddle, middle: true };
      continue;
    }
    if (onWall?.middle) continue;
    const projected = projectOnSegment(point, a, b);
    if (projected.distance <= tolerance && (!onWall || projected.distance < onWall.distance)) {
      onWall = { id: wall.id, point: projected.point, distance: projected.distance, middle: false };
    }
  }
  if (onWall && !onWall.middle && from) {
    // Drawing a wall that is nearly square to the grid: land where its
    // straight line meets the wall, not at the nearest point, so the new wall
    // comes out straight.
    const wall = floor.walls.find((candidate) => candidate.id === onWall!.id)!;
    const straight = straightOnto(from, point, position.get(wall.a)!, position.get(wall.b)!);
    if (straight && distance(straight, point) <= tolerance * 2) {
      return { point: clean(straight), kind: "wall", wallId: wall.id, guides: [] };
    }
  }
  if (onWall) {
    return {
      point: onWall.point,
      kind: onWall.middle ? "midpoint" : "wall",
      wallId: onWall.id,
      guides: [],
    };
  }

  // 3. Drawing from a point: hold the direction to a multiple of 45 degrees,
  //    then stop level with another corner if one is close, else on the grid.
  if (from) {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
    if (length > 0 && Math.abs(angle - snapped) <= ANGLE_TOLERANCE) {
      const ux = Math.cos(snapped);
      const uy = Math.sin(snapped);
      const along = dx * ux + dy * uy;
      let best: { along: number; corner: Point } | undefined;
      for (const vertex of vertices) {
        // Where the ray is level with this corner, horizontally and vertically.
        const candidates: number[] = [];
        if (Math.abs(ux) > 1e-9) candidates.push((vertex.x - from.x) / ux);
        if (Math.abs(uy) > 1e-9) candidates.push((vertex.y - from.y) / uy);
        for (const candidate of candidates) {
          if (candidate <= 0 || Math.abs(candidate - along) > tolerance) continue;
          if (!best || Math.abs(candidate - along) < Math.abs(best.along - along)) {
            best = { along: candidate, corner: vertex };
          }
        }
      }
      if (best) {
        const snappedPoint = { x: from.x + ux * best.along, y: from.y + uy * best.along };
        return {
          point: clean(snappedPoint),
          kind: "align",
          guides: [{ from: { x: best.corner.x, y: best.corner.y }, to: clean(snappedPoint) }],
        };
      }
      const stepped = grid > 0 ? Math.max(grid, roundTo(along, grid)) : along;
      return {
        point: clean({ x: from.x + ux * stepped, y: from.y + uy * stepped }),
        kind: "angle",
        guides: [],
      };
    }
  }

  // 4. Level with other corners, each axis on its own, else the grid.
  const guides: Guide[] = [];
  const axis = (key: "x" | "y"): number => {
    let level: { x: number; y: number } | undefined;
    let gap = tolerance;
    for (const vertex of vertices) {
      const d = Math.abs(vertex[key] - point[key]);
      if (d <= gap) {
        level = vertex;
        gap = d;
      }
    }
    if (level) {
      guides.push({ from: { x: level.x, y: level.y }, to: point });
      return level[key];
    }
    return grid > 0 ? roundTo(point[key], grid) : point[key];
  };
  const snappedPoint = { x: axis("x"), y: axis("y") };
  for (const guide of guides) guide.to = snappedPoint;
  const kind: SnapKind = guides.length > 0 ? "align" : grid > 0 ? "grid" : "none";
  return { point: snappedPoint, kind, guides };
}

/** Where the line from `from` towards `point`, held to the nearest multiple
 * of 45 degrees, meets the segment a-b. Undefined if the direction is not
 * near such a multiple, or the line misses the segment. */
function straightOnto(from: Point, point: Point, a: Point, b: Point): Point | undefined {
  const angle = Math.atan2(point.y - from.y, point.x - from.x);
  const snapped = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
  if (Math.abs(angle - snapped) > ANGLE_TOLERANCE) return undefined;
  const ux = Math.cos(snapped);
  const uy = Math.sin(snapped);
  const wx = b.x - a.x;
  const wy = b.y - a.y;
  const denominator = ux * wy - uy * wx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const along = ((a.x - from.x) * wy - (a.y - from.y) * wx) / denominator;
  const across = ((a.x - from.x) * uy - (a.y - from.y) * ux) / denominator;
  if (along <= 0 || across < 0 || across > 1) return undefined;
  return { x: from.x + ux * along, y: from.y + uy * along };
}

function clean(point: Point): Point {
  return { x: Number(point.x.toFixed(6)), y: Number(point.y.toFixed(6)) };
}
