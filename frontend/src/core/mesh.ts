// Turns a floor into triangles: a slab for each room and a solid for each
// wall, with corners mitred so that walls meet cleanly. No three.js here: the
// result is plain numbers, which makes it testable and lets the renderer be
// swapped or shared.
//
// Axes: x is the plan's x, y is up, z is the plan's y. So looking straight
// down, the model matches the plan.

import {
  distance,
  interiorPoint,
  pointInPolygon,
  polygonArea,
  signedArea,
  triangulate,
  type Point,
} from "./geometry";
import { roomPolygon } from "./rooms";
import type { Floor, Opening, Room, Wall } from "./scene";

export type Colour = readonly [number, number, number];
type Vec3 = readonly [number, number, number];

/** Triangles, not indexed: nine position numbers, nine normal numbers and
 * nine colour numbers for each. */
export interface MeshData {
  positions: number[];
  normals: number[];
  colours: number[];
}

/** One wall on its own, so that it can be lowered out of the camera's way. */
export interface WallPart {
  id: string;
  data: MeshData;
  /** The panes of its windows, to be drawn see-through. */
  glass?: MeshData;
  /** The middle of the wall on the floor, in model axes: [x, z]. */
  centre: [number, number];
  height: number;
}

export interface FloorMesh {
  slabs: MeshData;
  /** Every wall in one mesh. */
  walls: MeshData;
  /** The same walls, one mesh each. */
  wallParts: WallPart[];
  /** The box the floor fits in, in model axes; undefined when it is empty. */
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}

export interface MeshOptions {
  /** Flat colour for each floor finish. */
  floorColours: Readonly<Record<string, Colour>>;
  /** The outside of the house, and anything else that faces no room. */
  outsideColour: Colour;
  /** The cut tops of the walls. */
  wallTopColour: Colour;
  /** Window panes. */
  glassColour?: Colour;
  /** Draw this room's floor in `highlightColour`. */
  highlightRoom?: string | null;
  highlightColour?: Colour;
  /** Walls are drawn no taller than this: lets you see into the rooms. */
  maxWallHeight?: number;
}

/** A mitre longer than this many wall thicknesses is squared off instead. */
const MITRE_LIMIT = 3;
const SIDE_PROBE = 0.05;

export function hexColour(hex: string): Colour {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  if (!/^#?[0-9a-f]{6}$/i.test(hex) || Number.isNaN(value)) return [0.8, 0.8, 0.8];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** The outline of each wall on the floor, as six points: its first end, the
 * left corner there, the left corner at the far end, the far end, the right
 * corner there, the right corner at the first end. Adjoining walls share
 * their corner points, so the outlines fit together without gaps or overlap. */
export function wallFootprints(floor: Pick<Floor, "vertices" | "walls">): Map<string, Point[]> {
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  interface End {
    wall: Wall;
    /** Unit vector along the wall, away from this vertex. */
    dx: number;
    dy: number;
    half: number;
    angle: number;
    left?: Point;
    right?: Point;
  }
  const ends = new Map<string, End[]>();
  const endOf = new Map<string, End>();
  for (const wall of floor.walls) {
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!a || !b) continue;
    const length = distance(a, b);
    if (length === 0) continue;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const half = wall.thickness / 2;
    const atA: End = { wall, dx, dy, half, angle: Math.atan2(dy, dx) };
    const atB: End = { wall, dx: -dx, dy: -dy, half, angle: Math.atan2(-dy, -dx) };
    ends.set(wall.a, [...(ends.get(wall.a) ?? []), atA]);
    ends.set(wall.b, [...(ends.get(wall.b) ?? []), atB]);
    endOf.set(`${wall.id}@${wall.a}`, atA);
    endOf.set(`${wall.id}@${wall.b}`, atB);
  }

  // "Left" of a direction is a quarter turn towards larger angles, so the
  // wall to the left of this one at a vertex is the next one by angle.
  const leftOf = (end: End, at: Point): Point => ({
    x: at.x - end.dy * end.half,
    y: at.y + end.dx * end.half,
  });
  const rightOf = (end: End, at: Point): Point => ({
    x: at.x + end.dy * end.half,
    y: at.y - end.dx * end.half,
  });

  for (const [vertexId, around] of ends) {
    const at = position.get(vertexId)!;
    around.sort((p, q) => p.angle - q.angle);
    for (let i = 0; i < around.length; i++) {
      const end = around[i];
      const next = around[(i + 1) % around.length];
      const ownLeft = leftOf(end, at);
      const nextRight = rightOf(next, at);
      if (around.length === 1) {
        end.left = ownLeft;
        end.right = rightOf(end, at);
        continue;
      }
      // Where this wall's left face meets the next wall's right face.
      const denominator = end.dx * next.dy - end.dy * next.dx;
      let corner: Point | undefined;
      if (Math.abs(denominator) > 1e-6) {
        const t =
          ((nextRight.x - ownLeft.x) * next.dy - (nextRight.y - ownLeft.y) * next.dx) /
          denominator;
        const candidate = { x: ownLeft.x + end.dx * t, y: ownLeft.y + end.dy * t };
        const reach = MITRE_LIMIT * 2 * Math.max(end.half, next.half);
        if (distance(candidate, at) <= reach) corner = candidate;
      }
      end.left = corner ?? ownLeft;
      next.right = corner ?? nextRight;
    }
  }

  const footprints = new Map<string, Point[]>();
  for (const wall of floor.walls) {
    const first = endOf.get(`${wall.id}@${wall.a}`);
    const far = endOf.get(`${wall.id}@${wall.b}`);
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!first || !far || !a || !b || !first.left || !first.right || !far.left || !far.right) {
      continue;
    }
    // Seen from the far end the wall runs the other way, so its sides swap.
    footprints.set(wall.id, [
      { x: a.x, y: a.y },
      first.left,
      far.right,
      { x: b.x, y: b.y },
      far.left,
      first.right,
    ]);
  }
  return footprints;
}

/** The room on each side of every wall: [left, right], as in `wallFootprints`. */
export function wallSides(floor: Floor): Map<string, [Room | undefined, Room | undefined]> {
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  const rooms = floor.rooms
    .map((room) => {
      const polygon = roomPolygon(floor, room);
      return { room, polygon, area: polygonArea(polygon) };
    })
    .filter((entry) => entry.polygon.length >= 3)
    .sort((p, q) => p.area - q.area);
  const roomAt = (point: Point) => rooms.find((entry) => pointInPolygon(point, entry.polygon))?.room;

  const sides = new Map<string, [Room | undefined, Room | undefined]>();
  for (const wall of floor.walls) {
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!a || !b) continue;
    const length = distance(a, b);
    if (length === 0) continue;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const reach = wall.thickness / 2 + SIDE_PROBE;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    sides.set(wall.id, [
      roomAt({ x: middle.x - dy * reach, y: middle.y + dx * reach }),
      roomAt({ x: middle.x + dy * reach, y: middle.y - dx * reach }),
    ]);
  }
  return sides;
}

/** How many other rooms each room sits inside. A room inside a room is drawn
 * a hair higher, so the two floors do not flicker through each other. */
export function roomNesting(floor: Floor): Map<string, number> {
  const polygons = floor.rooms.map((room) => ({ room, polygon: roomPolygon(floor, room) }));
  const nesting = new Map<string, number>();
  for (const { room, polygon } of polygons) {
    if (polygon.length < 3) continue;
    const inside = interiorPoint(polygon);
    const area = polygonArea(polygon);
    let depth = 0;
    for (const other of polygons) {
      if (other.room === room || other.polygon.length < 3) continue;
      if (polygonArea(other.polygon) > area && pointInPolygon(inside, other.polygon)) depth++;
    }
    nesting.set(room.id, depth);
  }
  return nesting;
}

export function buildFloorMesh(floor: Floor, options: MeshOptions): FloorMesh {
  const slabs: MeshData = { positions: [], normals: [], colours: [] };
  const walls: MeshData = { positions: [], normals: [], colours: [] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  };
  const push = (
    mesh: MeshData,
    corners: readonly (readonly [number, number, number])[],
    normal: readonly [number, number, number],
    colour: Colour,
  ) => {
    for (const [x, y, z] of corners) {
      mesh.positions.push(x, y, z);
      mesh.normals.push(...normal);
      mesh.colours.push(...colour);
      grow(x, y, z);
    }
  };

  // A horizontal face at height y, seen from above. Model z is plan y, which
  // turns the plan's winding round: emit each triangle reversed.
  const flat = (mesh: MeshData, outline: readonly Point[], y: number, colour: Colour) => {
    const indices = triangulate(outline);
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [outline[indices[i]], outline[indices[i + 1]], outline[indices[i + 2]]];
      push(mesh, [[a.x, y, a.y], [c.x, y, c.y], [b.x, y, b.y]], [0, 1, 0], colour);
    }
  };

  const nesting = roomNesting(floor);
  for (const room of floor.rooms) {
    const polygon = roomPolygon(floor, room);
    if (polygon.length < 3) continue;
    const colour =
      options.highlightRoom === room.id && options.highlightColour
        ? options.highlightColour
        : (options.floorColours[room.floor_style] ?? options.floorColours.default);
    flat(slabs, polygon, 0.001 * (nesting.get(room.id) ?? 0), colour);
  }

  // A flat four-sided face, wound to face the way `normal` points.
  const quad = (
    mesh: MeshData,
    corners: readonly [Vec3, Vec3, Vec3, Vec3],
    normal: Vec3,
    colour: Colour,
  ) => {
    const [a, b, c, d] = corners;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const facing =
      (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2];
    if (Math.abs(facing) < 1e-12) return;
    push(mesh, facing > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c], normal, colour);
  };

  const footprints = wallFootprints(floor);
  const sides = wallSides(floor);
  const openingsOf = new Map<string, Opening[]>();
  for (const opening of floor.openings) {
    openingsOf.set(opening.wall, [...(openingsOf.get(opening.wall) ?? []), opening]);
  }
  const glassColour = options.glassColour ?? [0.72, 0.86, 0.92];
  const wallParts: WallPart[] = [];
  for (const wall of floor.walls) {
    const outline = footprints.get(wall.id);
    if (!outline) continue;
    const part: MeshData = { positions: [], normals: [], colours: [] };
    const glass: MeshData = { positions: [], normals: [], colours: [] };
    const height = Math.min(wall.height ?? floor.wall_height, options.maxWallHeight ?? Infinity);
    const [leftRoom, rightRoom] = sides.get(wall.id) ?? [undefined, undefined];
    const leftColour = leftRoom ? hexColour(leftRoom.wall_colour) : options.outsideColour;
    const rightColour = rightRoom ? hexColour(rightRoom.wall_colour) : options.outsideColour;

    // The wall's own line: from its first end A along the unit vector d.
    const start = outline[0];
    const end = outline[3];
    const length = distance(start, end);
    const dx = (end.x - start.x) / length;
    const dy = (end.y - start.y) / length;
    const half = wall.thickness / 2;
    // The holes in it, as stretches along that line, bottom and top.
    const holes = (openingsOf.get(wall.id) ?? [])
      .map((opening) => ({
        from: Math.max(0, opening.offset),
        to: Math.min(length, opening.offset + opening.width),
        bottom: Math.min(opening.sill, height),
        top: Math.min(opening.sill + opening.height, height),
        window: opening.type === "window",
      }))
      .filter((hole) => hole.to - hole.from > 1e-4 && hole.top - hole.bottom > 1e-4)
      .sort((p, q) => p.from - q.from);

    // The outline's winding decides which way "outwards" is for its edges.
    const turn = signedArea(outline) >= 0 ? 1 : -1;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      const edge = distance(p, q);
      if (edge < 1e-6) continue;
      const normal: Vec3 = [(turn * (q.y - p.y)) / edge, 0, (-turn * (q.x - p.x)) / edge];
      // Edge 1 is the left face, edge 4 the right; the rest are the joints.
      const colour = i === 1 ? leftColour : i === 4 ? rightColour : options.outsideColour;
      const face = (from: Point, to: Point, bottom: number, top: number) =>
        quad(
          part,
          [
            [from.x, bottom, from.y],
            [to.x, bottom, to.y],
            [to.x, top, to.y],
            [from.x, top, from.y],
          ],
          normal,
          colour,
        );
      if ((i !== 1 && i !== 4) || holes.length === 0) {
        face(p, q, 0, height);
        continue;
      }
      // A long face: solid between the holes, and above and below each.
      const along = (point: Point) => (point.x - start.x) * dx + (point.y - start.y) * dy;
      const sp = along(p);
      const lo = Math.min(sp, along(q));
      const hi = Math.max(sp, along(q));
      const at = (s: number): Point => ({ x: p.x + dx * (s - sp), y: p.y + dy * (s - sp) });
      let cursor = lo;
      for (const hole of holes) {
        const from = Math.min(Math.max(hole.from, lo), hi);
        const to = Math.min(Math.max(hole.to, lo), hi);
        if (to - from < 1e-4) continue;
        if (from > cursor) face(at(cursor), at(from), 0, height);
        if (hole.bottom > 0) face(at(Math.max(from, cursor)), at(to), 0, hole.bottom);
        if (hole.top < height) face(at(Math.max(from, cursor)), at(to), hole.top, height);
        cursor = Math.max(cursor, to);
      }
      if (hi > cursor) face(at(cursor), at(hi), 0, height);
    }

    // The inside of each hole: the two jambs, the sill and the head; and for a
    // window, a pane down the middle of the wall.
    const onLine = (s: number, across: number): Point => ({
      x: start.x + dx * s - dy * across,
      y: start.y + dy * s + dx * across,
    });
    for (const hole of holes) {
      const corner = (s: number, across: number, y: number): Vec3 => {
        const point = onLine(s, across);
        return [point.x, y, point.y];
      };
      const reveal = options.outsideColour;
      for (const [s, facing] of [[hole.from, 1], [hole.to, -1]] as const) {
        quad(
          part,
          [corner(s, half, hole.bottom), corner(s, -half, hole.bottom), corner(s, -half, hole.top), corner(s, half, hole.top)],
          [dx * facing, 0, dy * facing],
          reveal,
        );
      }
      const across = (y: number, up: 1 | -1) =>
        quad(
          part,
          [corner(hole.from, half, y), corner(hole.to, half, y), corner(hole.to, -half, y), corner(hole.from, -half, y)],
          [0, up, 0],
          reveal,
        );
      if (hole.bottom > 0) across(hole.bottom, 1);
      if (hole.top < height) across(hole.top, -1);
      if (hole.window) {
        const pane: [Vec3, Vec3, Vec3, Vec3] = [
          corner(hole.from, 0, hole.bottom),
          corner(hole.to, 0, hole.bottom),
          corner(hole.to, 0, hole.top),
          corner(hole.from, 0, hole.top),
        ];
        quad(glass, pane, [-dy, 0, dx], glassColour);
        quad(glass, pane, [dy, 0, -dx], glassColour);
      }
    }

    flat(part, outline, height, options.wallTopColour);
    walls.positions.push(...part.positions);
    walls.normals.push(...part.normals);
    walls.colours.push(...part.colours);
    wallParts.push({
      id: wall.id,
      data: part,
      ...(glass.positions.length > 0 ? { glass } : {}),
      centre: [(start.x + end.x) / 2, (start.y + end.y) / 2],
      height,
    });
  }

  return Number.isFinite(min[0])
    ? { slabs, walls, wallParts, bounds: { min, max } }
    : { slabs, walls, wallParts };
}
