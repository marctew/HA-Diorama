import type { Floor } from "../core/scene";

/** What is selected in the plan: corners, walls and furniture together, or
 * one room. */
export interface Selection {
  vertices: readonly string[];
  walls: readonly string[];
  items: readonly string[];
  room: string | null;
}

export const NO_SELECTION: Selection = { vertices: [], walls: [], items: [], room: null };

export function isEmpty(selection: Selection): boolean {
  return selectionCount(selection) === 0 && selection.room === null;
}

/** How many corners, walls and pieces of furniture are selected. */
export function selectionCount(selection: Selection): number {
  return selection.vertices.length + selection.walls.length + selection.items.length;
}

/** Drop anything from the selection that the floor no longer has. Returns the
 * same object when nothing had to go. */
export function prune(selection: Selection, floor: Floor): Selection {
  const vertexIds = new Set(floor.vertices.map((vertex) => vertex.id));
  const wallIds = new Set(floor.walls.map((wall) => wall.id));
  const itemIds = new Set(floor.items.map((item) => item.id));
  const vertices = selection.vertices.filter((id) => vertexIds.has(id));
  const walls = selection.walls.filter((id) => wallIds.has(id));
  const items = selection.items.filter((id) => itemIds.has(id));
  const room =
    selection.room !== null && floor.rooms.some((r) => r.id === selection.room)
      ? selection.room
      : null;
  if (
    vertices.length === selection.vertices.length &&
    walls.length === selection.walls.length &&
    items.length === selection.items.length &&
    room === selection.room
  ) {
    return selection;
  }
  return { vertices, walls, items, room };
}

/** Add an id to a list, or take it out if it is there (shift-click). */
export function toggle(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}
