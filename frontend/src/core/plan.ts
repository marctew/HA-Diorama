// Editing a floor's walls. Every function returns a new floor and leaves the
// one it was given alone, which is what makes undo a matter of keeping the old
// one. Walls are a graph: vertices, and segments between them. `commit` keeps
// that graph tidy after each edit, so that rooms can be found in it.

import {
  distance,
  MERGE_DISTANCE,
  projectOnSegment,
  segmentIntersection,
  type Point,
} from "./geometry";
import { newId, type MakeId } from "./ids";
import { detectRooms } from "./rooms";
import type { Floor, Opening, Vertex, Wall } from "./scene";

export const DEFAULT_WALL_THICKNESS = 0.1;

/** Tidy the wall graph, find the rooms again and drop references to things
 * that are gone. Call it after every edit that is finished (not while
 * dragging).
 *
 * Tidying means: vertices in the same place become one, a wall that passes
 * through a vertex or crosses another wall is split there, walls of no length
 * and second walls between the same two vertices go, and so do vertices that
 * no wall uses. */
export function commit(floor: Floor, makeId: MakeId = newId): Floor {
  const tidy = normalise(floor, makeId);
  const rooms = detectRooms(tidy, makeId, floor.vertices);
  const roomIds = new Set(rooms.map((room) => room.id));
  const itemIds = new Set(tidy.items.map((item) => item.id));
  return {
    ...tidy,
    rooms,
    items: tidy.items.map((item) =>
      item.room !== null && !roomIds.has(item.room) ? { ...item, room: null } : item,
    ),
    fixtures: tidy.fixtures.map((fixture) => {
      const room = fixture.room !== null && !roomIds.has(fixture.room) ? null : fixture.room;
      const item = fixture.item !== null && !itemIds.has(fixture.item) ? null : fixture.item;
      return room === fixture.room && item === fixture.item ? fixture : { ...fixture, room, item };
    }),
  };
}

function normalise(floor: Floor, makeId: MakeId): Floor {
  // Vertices in the same place become the first of them.
  const vertices: Vertex[] = [];
  const replacement = new Map<string, string>();
  for (const vertex of floor.vertices) {
    const twin = vertices.find((kept) => distance(kept, vertex) < MERGE_DISTANCE);
    if (twin) replacement.set(vertex.id, twin.id);
    else vertices.push(vertex);
  }
  const resolve = (id: string) => replacement.get(id) ?? id;
  let walls: Wall[] = floor.walls.map((wall) => {
    const a = resolve(wall.a);
    const b = resolve(wall.b);
    return a === wall.a && b === wall.b ? wall : { ...wall, a, b };
  });
  let openings: Opening[] = floor.openings;
  // A vertex that no wall uses is not part of the plan. Drop those first, or
  // one lying on a wall (a corner that was just deleted) would split it.
  const inUse = new Set(walls.flatMap((wall) => (wall.a === wall.b ? [] : [wall.a, wall.b])));
  for (let i = vertices.length - 1; i >= 0; i--) {
    if (!inUse.has(vertices[i].id)) vertices.splice(i, 1);
  }
  const position = new Map(vertices.map((v) => [v.id, v]));

  const dropDegenerate = () => {
    const spans = new Set<string>();
    const kept: Wall[] = [];
    for (const wall of walls) {
      const span = wall.a < wall.b ? `${wall.a}|${wall.b}` : `${wall.b}|${wall.a}`;
      if (wall.a === wall.b || spans.has(span)) continue;
      if (!position.has(wall.a) || !position.has(wall.b)) continue;
      spans.add(span);
      kept.push(wall);
    }
    if (kept.length !== walls.length) {
      const ids = new Set(kept.map((wall) => wall.id));
      openings = openings.filter((opening) => ids.has(opening.wall));
      walls = kept;
    }
  };

  // Split a wall in two at a vertex that lies on it. Openings stay where they
  // are in the room, which means some move to the new second half.
  const splitAt = (index: number, vertexId: string) => {
    const wall = walls[index];
    const cut = distance(position.get(wall.a)!, position.get(vertexId)!);
    const second: Wall = { ...wall, id: makeId("w"), a: vertexId };
    walls = [
      ...walls.slice(0, index),
      { ...wall, b: vertexId },
      second,
      ...walls.slice(index + 1),
    ];
    openings = openings.map((opening) => {
      if (opening.wall !== wall.id || opening.offset + opening.width / 2 <= cut) return opening;
      return { ...opening, wall: second.id, offset: Math.max(0, opening.offset - cut) };
    });
  };

  const splitAtVertexOnWall = (): boolean => {
    for (let index = 0; index < walls.length; index++) {
      const wall = walls[index];
      const a = position.get(wall.a)!;
      const b = position.get(wall.b)!;
      for (const vertex of vertices) {
        if (vertex.id === wall.a || vertex.id === wall.b) continue;
        if (projectOnSegment(vertex, a, b).distance >= MERGE_DISTANCE) continue;
        splitAt(index, vertex.id);
        return true;
      }
    }
    return false;
  };

  const splitAtCrossing = (): boolean => {
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const first = walls[i];
        const second = walls[j];
        if (
          first.a === second.a ||
          first.a === second.b ||
          first.b === second.a ||
          first.b === second.b
        ) {
          continue;
        }
        const point = segmentIntersection(
          position.get(first.a)!,
          position.get(first.b)!,
          position.get(second.a)!,
          position.get(second.b)!,
        );
        if (!point) continue;
        const vertex: Vertex = { id: makeId("v"), x: point.x, y: point.y };
        vertices.push(vertex);
        position.set(vertex.id, vertex);
        splitAt(j, vertex.id);
        splitAt(i, vertex.id);
        return true;
      }
    }
    return false;
  };

  // Each pass makes one split; a floor needs at most a few.
  for (let guard = 0; guard < 100000; guard++) {
    dropDegenerate();
    if (splitAtVertexOnWall()) continue;
    if (splitAtCrossing()) continue;
    break;
  }

  const used = new Set<string>();
  for (const wall of walls) {
    used.add(wall.a);
    used.add(wall.b);
  }
  const keptVertices = vertices.filter((vertex) => used.has(vertex.id));
  const unchanged =
    keptVertices.length === floor.vertices.length &&
    keptVertices.every((vertex, i) => vertex === floor.vertices[i]);
  return {
    ...floor,
    vertices: unchanged ? floor.vertices : keptVertices,
    walls,
    openings,
  };
}

/** Draw a wall from p to q. Ends that land on an existing vertex use it; a
 * wall that crosses others is split where it does. Returns the floor
 * unchanged if p and q are the same place. */
export function addWall(floor: Floor, p: Point, q: Point, makeId: MakeId = newId): Floor {
  if (distance(p, q) < MERGE_DISTANCE) return floor;
  const vertices = [...floor.vertices];
  const endpoint = (point: Point): string => {
    const existing = vertices.find((vertex) => distance(vertex, point) < MERGE_DISTANCE);
    if (existing) return existing.id;
    const vertex: Vertex = { id: makeId("v"), x: point.x, y: point.y };
    vertices.push(vertex);
    return vertex.id;
  };
  const a = endpoint(p);
  const b = endpoint(q);
  const wall: Wall = { id: makeId("w"), a, b, thickness: wallThickness(floor), height: null };
  return commit({ ...floor, vertices, walls: [...floor.walls, wall] }, makeId);
}

/** New walls are as thick as the last one drawn. */
function wallThickness(floor: Floor): number {
  return floor.walls.at(-1)?.thickness ?? DEFAULT_WALL_THICKNESS;
}

/** Put vertices somewhere else, without tidying: for showing a drag as it
 * happens. Call `commit` when the drag ends. */
export function moveVertices(floor: Floor, positions: ReadonlyMap<string, Point>): Floor {
  if (positions.size === 0) return floor;
  return {
    ...floor,
    vertices: floor.vertices.map((vertex) => {
      const to = positions.get(vertex.id);
      return to ? { ...vertex, x: to.x, y: to.y } : vertex;
    }),
  };
}

/** Remove walls and their openings. Vertices left with no wall go too, and a
 * vertex left in the middle of a straight run (where a deleted wall used to
 * join) is taken out, so the run is one wall again. */
export function deleteWalls(
  floor: Floor,
  ids: ReadonlySet<string>,
  makeId: MakeId = newId,
): Floor {
  const removed = floor.walls.filter((wall) => ids.has(wall.id));
  if (removed.length === 0) return floor;
  let walls = floor.walls.filter((wall) => !ids.has(wall.id));
  let openings = floor.openings.filter((opening) => !ids.has(opening.wall));
  const position = new Map(floor.vertices.map((v) => [v.id, v]));
  for (const vertexId of new Set(removed.flatMap((wall) => [wall.a, wall.b]))) {
    const touching = walls.filter((wall) => wall.a === vertexId || wall.b === vertexId);
    if (touching.length !== 2) continue;
    const [first, second] = touching;
    if (first.thickness !== second.thickness || first.height !== second.height) continue;
    const from = position.get(first.a === vertexId ? first.b : first.a);
    const to = position.get(second.a === vertexId ? second.b : second.a);
    const middle = position.get(vertexId);
    if (!from || !to || !middle || from.id === to.id) continue;
    if (projectOnSegment(middle, from, to).distance >= MERGE_DISTANCE) continue;
    if (distance(from, middle) + distance(middle, to) > distance(from, to) + MERGE_DISTANCE) continue;
    if (walls.some((wall) => spans(wall, from.id, to.id))) continue;
    ({ walls, openings } = joinWalls(walls, openings, first, second, vertexId, position, true));
  }
  return commit({ ...floor, walls, openings }, makeId);
}

function spans(wall: Wall, a: string, b: string): boolean {
  return (wall.a === a && wall.b === b) || (wall.a === b && wall.b === a);
}

/** Replace two walls that meet at a vertex with one wall between their far
 * ends. It keeps the first wall's id. Openings are carried over when the two
 * walls were in line (their place along the wall still means something) and
 * dropped otherwise. */
function joinWalls(
  walls: Wall[],
  openings: Opening[],
  first: Wall,
  second: Wall,
  vertexId: string,
  position: ReadonlyMap<string, Point>,
  keepOpenings: boolean,
): { walls: Wall[]; openings: Opening[] } {
  const start = first.a === vertexId ? first.b : first.a;
  const end = second.a === vertexId ? second.b : second.a;
  const joined: Wall = { ...first, a: start, b: end };
  const firstLength = distance(position.get(start)!, position.get(vertexId)!);
  const secondLength = distance(position.get(vertexId)!, position.get(end)!);
  return {
    walls: walls.flatMap((wall) =>
      wall.id === first.id ? [joined] : wall.id === second.id ? [] : [wall],
    ),
    openings: openings.flatMap((opening) => {
      if (opening.wall !== first.id && opening.wall !== second.id) return [opening];
      if (!keepOpenings) return [];
      // Measure every opening from the joined wall's first end.
      let offset: number;
      if (opening.wall === first.id) {
        offset = first.a === start ? opening.offset : firstLength - opening.offset - opening.width;
      } else {
        offset =
          firstLength +
          (second.a === vertexId ? opening.offset : secondLength - opening.offset - opening.width);
      }
      return [{ ...opening, wall: first.id, offset: Math.max(0, Number(offset.toFixed(6))) }];
    }),
  };
}

/** Remove vertices. A vertex that only joins two walls end to end is taken
 * out of the line and the two become one; otherwise its walls go with it. */
export function deleteVertices(
  floor: Floor,
  ids: ReadonlySet<string>,
  makeId: MakeId = newId,
): Floor {
  let walls = floor.walls;
  let openings = floor.openings;
  let changed = false;
  const position = new Map(floor.vertices.map((v) => [v.id, v]));
  for (const id of ids) {
    const touching = walls.filter((wall) => wall.a === id || wall.b === id);
    if (touching.length === 0) continue;
    changed = true;
    const others = touching.map((wall) => (wall.a === id ? wall.b : wall.a));
    const canJoin =
      touching.length === 2 &&
      others[0] !== others[1] &&
      !ids.has(others[0]) &&
      !ids.has(others[1]) &&
      !walls.some((wall) => spans(wall, others[0], others[1]));
    if (canJoin) {
      const from = position.get(others[0])!;
      const to = position.get(others[1])!;
      const inLine = projectOnSegment(position.get(id)!, from, to).distance < MERGE_DISTANCE;
      ({ walls, openings } = joinWalls(walls, openings, touching[0], touching[1], id, position, inLine));
    } else {
      const gone = new Set(touching.map((wall) => wall.id));
      walls = walls.filter((wall) => !gone.has(wall.id));
      openings = openings.filter((opening) => !gone.has(opening.wall));
    }
  }
  if (!changed) return floor;
  return commit({ ...floor, walls, openings }, makeId);
}

/** Make a wall a given length by moving one end along its line: the end
 * with fewer other walls attached, so as little else as possible moves. */
export function setWallLength(
  floor: Floor,
  wallId: string,
  length: number,
  makeId: MakeId = newId,
): Floor {
  const wall = floor.walls.find((candidate) => candidate.id === wallId);
  if (!wall || !(length >= MERGE_DISTANCE * 2)) return floor;
  const position = new Map(floor.vertices.map((v) => [v.id, v]));
  const a = position.get(wall.a);
  const b = position.get(wall.b);
  if (!a || !b) return floor;
  const current = distance(a, b);
  if (current < MERGE_DISTANCE || Math.abs(current - length) < 1e-6) return floor;
  const degree = (id: string) =>
    floor.walls.filter((other) => other.a === id || other.b === id).length;
  const moveA = degree(wall.a) < degree(wall.b);
  const [fixed, moving] = moveA ? [b, a] : [a, b];
  const scale = length / current;
  const to = {
    x: fixed.x + (moving.x - fixed.x) * scale,
    y: fixed.y + (moving.y - fixed.y) * scale,
  };
  return commit(moveVertices(floor, new Map([[moving.id, to]])), makeId);
}

export function setWallThickness(floor: Floor, wallId: string, thickness: number): Floor {
  return {
    ...floor,
    walls: floor.walls.map((wall) => (wall.id === wallId ? { ...wall, thickness } : wall)),
  };
}

/** The length of a wall, or 0 if it is not there. */
export function wallLength(floor: Pick<Floor, "vertices" | "walls">, wallId: string): number {
  const wall = floor.walls.find((candidate) => candidate.id === wallId);
  const a = wall && floor.vertices.find((vertex) => vertex.id === wall.a);
  const b = wall && floor.vertices.find((vertex) => vertex.id === wall.b);
  return a && b ? distance(a, b) : 0;
}
