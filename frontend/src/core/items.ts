// Furniture on a floor. An item has a model, a position, and a rotation in
// degrees: at 0 its front faces down the plan (+y), and positive turns it
// clockwise as seen from above. Like plan.ts, every function returns a new
// floor.

import type { CatalogueModel } from "./catalogue";
import {
  distance,
  pointInPolygon,
  polygonArea,
  projectOnSegment,
  type Point,
} from "./geometry";
import { newId, type MakeId } from "./ids";
import { syncFixtures } from "./fixtures";
import { roomPolygon } from "./rooms";
import type { Floor, Item } from "./scene";

/** Drawn for an item whose model the catalogue does not know. */
const UNKNOWN_SIZE = 0.5;

export const ROTATE_STEP = 15;

/** A model-space offset (across, back to front) turned into plan directions. */
function turn(across: number, front: number, rotation: number): Point {
  const angle = (rotation * Math.PI) / 180;
  return {
    x: across * Math.cos(angle) - front * Math.sin(angle),
    y: across * Math.sin(angle) + front * Math.cos(angle),
  };
}

/** Keep a rotation in the range -180 (exclusive) to 180. */
export function normaliseRotation(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : Number(wrapped.toFixed(3));
}

/** The four corners of the floor space an item takes up: back left, back
 * right, front right, front left. */
export function itemFootprint(item: Item, model: CatalogueModel | undefined): Point[] {
  const width = (model?.width ?? UNKNOWN_SIZE) * item.scale;
  const depth = (model?.depth ?? UNKNOWN_SIZE) * item.scale;
  const [cx, cz] = model?.centre ?? [0, 0];
  const corner = (across: number, front: number): Point => {
    const offset = turn((cx + across) * item.scale, (cz + front) * item.scale, item.rotation);
    return { x: item.x + offset.x, y: item.y + offset.y };
  };
  // Scale was applied to width and depth above; undo it inside corner().
  const w = width / item.scale / 2;
  const d = depth / item.scale / 2;
  return [corner(-w, -d), corner(w, -d), corner(w, d), corner(-w, d)];
}

/** The id of the room a point is in, or null. A room inside a room wins. */
export function roomAt(floor: Pick<Floor, "vertices" | "rooms">, point: Point): string | null {
  let best: { id: string; area: number } | undefined;
  for (const room of floor.rooms) {
    const polygon = roomPolygon(floor, room);
    if (polygon.length < 3 || !pointInPolygon(point, polygon)) continue;
    const area = polygonArea(polygon);
    if (!best || area < best.area) best = { id: room.id, area };
  }
  return best?.id ?? null;
}

export function placeItem(
  floor: Floor,
  model: string,
  point: Point,
  rotation = 0,
  makeId: MakeId = newId,
): { floor: Floor; id: string } {
  const id = makeId("i");
  const item: Item = {
    id,
    model,
    x: round(point.x),
    y: round(point.y),
    z: 0,
    rotation: normaliseRotation(rotation),
    scale: 1,
    room: roomAt(floor, point),
  };
  return { floor: { ...floor, items: [...floor.items, item] }, id };
}

/** Change items. Their room follows where they end up. */
export function updateItems(
  floor: Floor,
  ids: ReadonlySet<string>,
  change: (item: Item) => Partial<Item>,
): Floor {
  let changed = false;
  const items = floor.items.map((item) => {
    if (!ids.has(item.id)) return item;
    const next = { ...item, ...change(item) };
    next.x = round(next.x);
    next.y = round(next.y);
    next.rotation = normaliseRotation(next.rotation);
    next.room = roomAt(floor, next);
    const same = (Object.keys(next) as (keyof Item)[]).every((key) => next[key] === item[key]);
    if (same) return item;
    changed = true;
    return next;
  });
  return changed ? syncFixtures({ ...floor, items }) : floor;
}

export function moveItems(floor: Floor, positions: ReadonlyMap<string, Point>): Floor {
  return updateItems(floor, new Set(positions.keys()), (item) => positions.get(item.id)!);
}

export function rotateItems(floor: Floor, ids: ReadonlySet<string>, degrees: number): Floor {
  return updateItems(floor, ids, (item) => ({ rotation: item.rotation + degrees }));
}

/** Copy items, a little down and to the right. Returns the copies' ids. */
export function duplicateItems(
  floor: Floor,
  ids: ReadonlySet<string>,
  offset = 0.3,
  makeId: MakeId = newId,
): { floor: Floor; ids: string[] } {
  const copies: Item[] = [];
  for (const item of floor.items) {
    if (!ids.has(item.id)) continue;
    const position = { x: round(item.x + offset), y: round(item.y + offset) };
    copies.push({ ...item, ...position, id: makeId("i"), room: roomAt(floor, position) });
  }
  if (copies.length === 0) return { floor, ids: [] };
  return {
    floor: { ...floor, items: [...floor.items, ...copies] },
    ids: copies.map((copy) => copy.id),
  };
}

/** Remove items. A fixture that used one as its model is left without. */
export function deleteItems(floor: Floor, ids: ReadonlySet<string>): Floor {
  if (!floor.items.some((item) => ids.has(item.id))) return floor;
  return {
    ...floor,
    items: floor.items.filter((item) => !ids.has(item.id)),
    fixtures: floor.fixtures.map((fixture) =>
      fixture.item !== null && ids.has(fixture.item) ? { ...fixture, item: null } : fixture,
    ),
  };
}

/** Set the room of every item from where it is. Call after walls change. */
export function assignItemRooms(floor: Floor): Floor {
  let changed = false;
  const items = floor.items.map((item) => {
    const room = roomAt(floor, item);
    if (room === item.room) return item;
    changed = true;
    return { ...item, room };
  });
  return changed ? { ...floor, items } : floor;
}

/** Where to put a model so that its back is flat against the nearest wall,
 * facing into the room the pointer is in. Undefined when no wall is within
 * reach of the pointer. */
export function snapToWall(
  floor: Pick<Floor, "vertices" | "walls">,
  pointer: Point,
  model: CatalogueModel,
  scale: number,
  tolerance: number,
): { point: Point; rotation: number } | undefined {
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  const depth = model.depth * scale;
  let best: { distance: number; at: Point; nx: number; ny: number; half: number } | undefined;
  for (const wall of floor.walls) {
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!a || !b || distance(a, b) === 0) continue;
    const projected = projectOnSegment(pointer, a, b);
    if (projected.t <= 0 || projected.t >= 1 || projected.distance === 0) continue;
    const reach = wall.thickness / 2 + depth / 2 + tolerance;
    if (projected.distance > reach) continue;
    if (best && projected.distance >= best.distance) continue;
    best = {
      distance: projected.distance,
      at: projected.point,
      nx: (pointer.x - projected.point.x) / projected.distance,
      ny: (pointer.y - projected.point.y) / projected.distance,
      half: wall.thickness / 2,
    };
  }
  if (!best) return undefined;
  // Facing along the wall's normal: the front of a model at rotation r points
  // along (-sin r, cos r).
  const rotation = normaliseRotation((Math.atan2(-best.nx, best.ny) * 180) / Math.PI);
  const out = best.half + depth / 2;
  const middle = { x: best.at.x + best.nx * out, y: best.at.y + best.ny * out };
  const offset = turn(model.centre[0] * scale, model.centre[1] * scale, rotation);
  return {
    point: { x: round(middle.x - offset.x), y: round(middle.y - offset.y) },
    rotation,
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
