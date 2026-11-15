// The floors of a house: where a new one goes, and starting one from the
// outline of the floor below.

import { newId, type MakeId } from "./ids";
import { wallSides } from "./mesh";
import type { Floor, FloorMeta, Vertex, Wall } from "./scene";

/** How much a storey adds to the height of the walls: the floor structure. */
const FLOOR_DEPTH = 0.3;

/** A name and a height for a floor added on top of the house. */
export function nextFloor(
  floors: readonly FloorMeta[],
  topWallHeight = 2.4,
): { name: string; elevation: number } {
  if (floors.length === 0) return { name: "Ground floor", elevation: 0 };
  const top = floors.reduce((highest, floor) => (floor.elevation > highest.elevation ? floor : highest));
  const names = ["Ground floor", "First floor", "Second floor", "Third floor"];
  const taken = new Set(floors.map((floor) => floor.name));
  const name =
    names.find((candidate, index) => index >= floors.length && !taken.has(candidate)) ??
    `Floor ${floors.length + 1}`;
  return { name, elevation: Number((top.elevation + topWallHeight + FLOOR_DEPTH).toFixed(2)) };
}

/** Move a floor up or down the list. Returns the same list if it cannot go. */
export function moveFloor<T extends { id: string }>(floors: readonly T[], id: string, by: -1 | 1): readonly T[] {
  const from = floors.findIndex((floor) => floor.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= floors.length) return floors;
  const moved = [...floors];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}

/** The outside walls of a floor, as new walls with new ids: a start for the
 * floor above. A wall is outside if it has a room on one side only. */
export function outerWalls(
  floor: Floor,
  makeId: MakeId = newId,
): { vertices: Vertex[]; walls: Wall[] } {
  const sides = wallSides(floor);
  const vertexIds = new Map<string, string>();
  const copyOf = (id: string) => {
    if (!vertexIds.has(id)) vertexIds.set(id, makeId("v"));
    return vertexIds.get(id)!;
  };
  const walls: Wall[] = [];
  for (const wall of floor.walls) {
    const [left, right] = sides.get(wall.id) ?? [undefined, undefined];
    if (Boolean(left) === Boolean(right)) continue;
    walls.push({ ...wall, id: makeId("w"), a: copyOf(wall.a), b: copyOf(wall.b), height: null });
  }
  const vertices = floor.vertices
    .filter((vertex) => vertexIds.has(vertex.id))
    .map((vertex) => ({ ...vertex, id: vertexIds.get(vertex.id)! }));
  return { vertices, walls };
}
