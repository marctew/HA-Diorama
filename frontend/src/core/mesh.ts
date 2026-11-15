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
import type { Floor, Room, Wall } from "./scene";

export type Colour = readonly [number, number, number];

/** Triangles, not indexed: nine position numbers, nine normal numbers and
 * nine colour numbers for each. */
export interface MeshData {
  positions: number[];
  normals: number[];
  colours: number[];
}

export interface FloorMesh {
  slabs: MeshData;
  walls: MeshData;
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

  const footprints = wallFootprints(floor);
  const sides = wallSides(floor);
  for (const wall of floor.walls) {
    const outline = footprints.get(wall.id);
    if (!outline) continue;
    const height = Math.min(wall.height ?? floor.wall_height, options.maxWallHeight ?? Infinity);
    const [leftRoom, rightRoom] = sides.get(wall.id) ?? [undefined, undefined];
    const leftColour = leftRoom ? hexColour(leftRoom.wall_colour) : options.outsideColour;
    const rightColour = rightRoom ? hexColour(rightRoom.wall_colour) : options.outsideColour;
    // The outline's winding decides which way "outwards" is for its edges.
    const turn = signedArea(outline) >= 0 ? 1 : -1;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      const length = distance(p, q);
      if (length < 1e-6) continue;
      const nx = (turn * (q.y - p.y)) / length;
      const nz = (-turn * (q.x - p.x)) / length;
      // Edge 1 is the left face, edge 4 the right; the rest are the joints.
      const colour = i === 1 ? leftColour : i === 4 ? rightColour : options.outsideColour;
      const [first, second] = turn > 0 ? [q, p] : [p, q];
      push(
        walls,
        [
          [first.x, 0, first.y],
          [second.x, 0, second.y],
          [second.x, height, second.y],
          [first.x, 0, first.y],
          [second.x, height, second.y],
          [first.x, height, first.y],
        ],
        [nx, 0, nz],
        colour,
      );
    }
    flat(walls, outline, height, options.wallTopColour);
  }

  return Number.isFinite(min[0]) ? { slabs, walls, bounds: { min, max } } : { slabs, walls };
}
