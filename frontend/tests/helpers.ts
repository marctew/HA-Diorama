import type { MakeId } from "../src/core/ids";
import { addWall } from "../src/core/plan";
import type { Floor } from "../src/core/scene";
import type { Point } from "../src/core/geometry";

export function emptyFloor(id = "f1"): Floor {
  return {
    schema_version: 1,
    revision: 0,
    id,
    wall_height: 2.4,
    vertices: [],
    walls: [],
    openings: [],
    rooms: [],
    items: [],
    fixtures: [],
    trace: null,
  };
}

/** Ids that count up, so tests can name what they expect: v1, w1, r1... */
export function counter(): MakeId {
  const counts: Record<string, number> = {};
  return (prefix) => `${prefix}${(counts[prefix] = (counts[prefix] ?? 0) + 1)}`;
}

/** Draw a chain of walls through the points, as the wall tool does. */
export function draw(floor: Floor, makeId: MakeId, ...points: [number, number][]): Floor {
  let result = floor;
  for (let i = 0; i + 1 < points.length; i++) {
    result = addWall(result, p(points[i]), p(points[i + 1]), makeId);
  }
  return result;
}

export function p([x, y]: [number, number]): Point {
  return { x, y };
}

/** A closed rectangle from (x, y), width w, height h. */
export function rectangle(floor: Floor, makeId: MakeId, x: number, y: number, w: number, h: number): Floor {
  return draw(floor, makeId, [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]);
}

export function vertexAt(floor: Floor, x: number, y: number): string {
  const vertex = floor.vertices.find((v) => Math.hypot(v.x - x, v.y - y) < 0.001);
  if (!vertex) throw new Error(`no vertex at ${x}, ${y}`);
  return vertex.id;
}

export function wallBetween(floor: Floor, a: [number, number], b: [number, number]): string {
  const from = vertexAt(floor, ...a);
  const to = vertexAt(floor, ...b);
  const wall = floor.walls.find(
    (w) => (w.a === from && w.b === to) || (w.a === to && w.b === from),
  );
  if (!wall) throw new Error(`no wall between ${a} and ${b}`);
  return wall.id;
}

/** Fail if the floor would be refused by the server's reference checks. */
export function assertConsistent(floor: Floor): void {
  const vertexIds = new Set(floor.vertices.map((v) => v.id));
  const wallIds = new Set(floor.walls.map((w) => w.id));
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(floor.vertices.map((v) => v.id))) throw new Error("duplicate vertex id");
  if (!unique(floor.walls.map((w) => w.id))) throw new Error("duplicate wall id");
  if (!unique(floor.rooms.map((r) => r.id))) throw new Error("duplicate room id");
  const spans = new Set<string>();
  for (const wall of floor.walls) {
    if (!vertexIds.has(wall.a) || !vertexIds.has(wall.b)) throw new Error("wall without vertex");
    if (wall.a === wall.b) throw new Error("wall of no length");
    const span = [wall.a, wall.b].sort().join("|");
    if (spans.has(span)) throw new Error("two walls between the same vertices");
    spans.add(span);
  }
  for (const opening of floor.openings) {
    if (!wallIds.has(opening.wall)) throw new Error("opening without wall");
  }
  for (const room of floor.rooms) {
    if (room.boundary.length < 3) throw new Error("room with fewer than 3 corners");
    if (!unique(room.boundary)) throw new Error("room boundary repeats a vertex");
    if (!room.boundary.every((id) => vertexIds.has(id))) throw new Error("room without vertex");
  }
}

/** What the server fills in on an item or an opening that does not say. */
export const ITEM_DEFAULTS = {
  stretch: [1, 1, 1] as [number, number, number],
  on: null,
  cut_above: true,
};
export const DOOR_DEFAULTS = {
  leaves: 1 as const,
  hinge: "start" as const,
  swing: 1 as const,
  style: "hinged" as const,
  glazed: false,
};
