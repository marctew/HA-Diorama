import type { Floor } from "../core/scene";

/** What is selected in the plan: corners and walls together, or one room. */
export interface Selection {
  vertices: readonly string[];
  walls: readonly string[];
  room: string | null;
}

export const NO_SELECTION: Selection = { vertices: [], walls: [], room: null };

export function isEmpty(selection: Selection): boolean {
  return selection.vertices.length === 0 && selection.walls.length === 0 && selection.room === null;
}

/** Drop anything from the selection that the floor no longer has. Returns the
 * same object when nothing had to go. */
export function prune(selection: Selection, floor: Floor): Selection {
  const vertexIds = new Set(floor.vertices.map((vertex) => vertex.id));
  const wallIds = new Set(floor.walls.map((wall) => wall.id));
  const vertices = selection.vertices.filter((id) => vertexIds.has(id));
  const walls = selection.walls.filter((id) => wallIds.has(id));
  const room =
    selection.room !== null && floor.rooms.some((r) => r.id === selection.room)
      ? selection.room
      : null;
  if (
    vertices.length === selection.vertices.length &&
    walls.length === selection.walls.length &&
    room === selection.room
  ) {
    return selection;
  }
  return { vertices, walls, room };
}

/** Add an id to a list, or take it out if it is there (shift-click). */
export function toggle(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}
