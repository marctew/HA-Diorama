// Rooms are the closed faces of the wall graph. After every edit they are
// found again and matched to the rooms that were there before, so a room keeps
// its id, name and area while its walls are moved, split or joined.

import { interiorPoint, pointInPolygon, signedArea, type Point } from "./geometry";
import { newId, type MakeId } from "./ids";
import type { Floor, Room, Vertex } from "./scene";

export const DEFAULT_FLOOR_STYLE = "default";
export const DEFAULT_WALL_COLOUR = "#e8e4dc";

const MIN_ROOM_AREA = 0.01; // square metres

/** The vertex ids around each closed face of the wall graph, outer side excluded. */
export function findFaces(floor: Pick<Floor, "vertices" | "walls">): string[][] {
  const position = new Map(floor.vertices.map((v) => [v.id, v]));
  const neighbours = new Map<string, Set<string>>();
  for (const wall of floor.walls) {
    if (wall.a === wall.b || !position.has(wall.a) || !position.has(wall.b)) continue;
    if (!neighbours.has(wall.a)) neighbours.set(wall.a, new Set());
    if (!neighbours.has(wall.b)) neighbours.set(wall.b, new Set());
    neighbours.get(wall.a)!.add(wall.b);
    neighbours.get(wall.b)!.add(wall.a);
  }

  // A wall that leads nowhere is not part of any room's outline.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [id, around] of neighbours) {
      if (around.size > 1) continue;
      for (const other of around) neighbours.get(other)!.delete(id);
      neighbours.delete(id);
      pruned = true;
    }
  }

  // Around each vertex, its neighbours in order of angle.
  const ordered = new Map<string, string[]>();
  for (const [id, around] of neighbours) {
    const here = position.get(id)!;
    const angle = (other: string) => {
      const there = position.get(other)!;
      return Math.atan2(there.y - here.y, there.x - here.x);
    };
    ordered.set(
      id,
      [...around].sort((p, q) => angle(p) - angle(q)),
    );
  }

  // Walk every directed edge once. Arriving at a vertex, leave by the
  // neighbour just before the one we came from: that keeps the face on one
  // side all the way round, and gives inner faces a positive area and the
  // outside a negative one.
  const faces: string[][] = [];
  const walked = new Set<string>();
  for (const [start, around] of ordered) {
    for (const first of around) {
      if (walked.has(`${start}>${first}`)) continue;
      const cycle: string[] = [];
      let from = start;
      let to = first;
      while (!walked.has(`${from}>${to}`)) {
        walked.add(`${from}>${to}`);
        cycle.push(from);
        const options = ordered.get(to)!;
        const next = options[(options.indexOf(from) - 1 + options.length) % options.length];
        from = to;
        to = next;
      }
      const simple = simpleCycle(cycle, position);
      if (simple.length < 3) continue;
      if (signedArea(simple.map((id) => position.get(id)!)) > MIN_ROOM_AREA) faces.push(simple);
    }
  }
  return faces;
}

/** A face can pass through a vertex twice (two loops touching at a corner).
 * Keep the bigger loop, so a boundary never repeats a vertex. */
function simpleCycle(cycle: string[], position: Map<string, Point>): string[] {
  let current = cycle;
  for (;;) {
    const seen = new Map<string, number>();
    let cut: [number, number] | undefined;
    for (let i = 0; i < current.length; i++) {
      const before = seen.get(current[i]);
      if (before !== undefined) {
        cut = [before, i];
        break;
      }
      seen.set(current[i], i);
    }
    if (!cut) return current;
    const inner = current.slice(cut[0], cut[1]);
    const outer = [...current.slice(0, cut[0]), ...current.slice(cut[1])];
    const area = (ids: string[]) =>
      ids.length < 3 ? 0 : Math.abs(signedArea(ids.map((id) => position.get(id)!)));
    current = area(inner) > area(outer) ? inner : outer;
  }
}

/** The corners of a room, skipping any vertex that no longer exists. */
export function roomPolygon(floor: Pick<Floor, "vertices">, room: Pick<Room, "boundary">): Point[] {
  const position = new Map(floor.vertices.map((v) => [v.id, v]));
  const points: Point[] = [];
  for (const id of room.boundary) {
    const vertex = position.get(id);
    if (vertex) points.push({ x: vertex.x, y: vertex.y });
  }
  return points;
}

/** Find the rooms of a floor again, carrying over what is known about them.
 *
 * `before` is the vertices as they were before the edit was tidied up. A room
 * is recognised by where it was, and some of its corners may be gone by now
 * (two rooms joined, a split point removed). */
export function detectRooms(
  floor: Floor,
  makeId: MakeId = newId,
  before: readonly Vertex[] = [],
): Room[] {
  const position = new Map(floor.vertices.map((v) => [v.id, v]));
  const remembered = { vertices: [...before.filter((v) => !position.has(v.id)), ...floor.vertices] };
  const faces = findFaces(floor).map((boundary) => ({
    boundary,
    points: boundary.map((id) => position.get(id)!),
    set: new Set(boundary),
  }));
  const known = floor.rooms.map((room) => ({
    room,
    set: new Set(room.boundary),
    points: roomPolygon(remembered, room),
  }));

  // Every plausible pairing of an old room with a new face, best first.
  const pairs: { old: number; face: number; score: number }[] = [];
  known.forEach((old, oldIndex) => {
    faces.forEach((face, faceIndex) => {
      let shared = 0;
      for (const id of old.set) if (face.set.has(id)) shared++;
      const similarity = shared / (old.set.size + face.set.size - shared);
      if (similarity === 1) {
        pairs.push({ old: oldIndex, face: faceIndex, score: 2 });
        return;
      }
      // Same place: a point inside one lies inside the other.
      const overlaps =
        old.points.length >= 3 &&
        (pointInPolygon(interiorPoint(old.points), face.points) ||
          pointInPolygon(interiorPoint(face.points), old.points));
      if (overlaps) pairs.push({ old: oldIndex, face: faceIndex, score: similarity });
    });
  });
  pairs.sort((p, q) => q.score - p.score || p.old - q.old || p.face - q.face);

  const faceOfOld = new Map<number, number>();
  const takenFaces = new Set<number>();
  for (const pair of pairs) {
    if (faceOfOld.has(pair.old) || takenFaces.has(pair.face)) continue;
    faceOfOld.set(pair.old, pair.face);
    takenFaces.add(pair.face);
  }

  const rooms: Room[] = [];
  known.forEach((old, oldIndex) => {
    const faceIndex = faceOfOld.get(oldIndex);
    if (faceIndex === undefined) return;
    const boundary = faces[faceIndex].boundary;
    rooms.push(sameCycle(old.room.boundary, boundary) ? old.room : { ...old.room, boundary });
  });
  faces.forEach((face, faceIndex) => {
    if (takenFaces.has(faceIndex)) return;
    rooms.push({
      id: makeId("r"),
      name: "",
      area_id: null,
      boundary: face.boundary,
      floor_style: DEFAULT_FLOOR_STYLE,
      wall_colour: DEFAULT_WALL_COLOUR,
      open: false,
      temperature_entity: null,
    });
  });
  return rooms;
}

/** Whether two boundaries are the same loop, whichever corner they start at. */
function sameCycle(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const offset = b.indexOf(a[0]);
  if (offset < 0) return false;
  return a.every((id, i) => id === b[(i + offset) % b.length]);
}
